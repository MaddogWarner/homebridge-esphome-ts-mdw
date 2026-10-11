// Regression coverage for the esphome-client 2.x migration.
//
// Runs against the built output in dist/ so the tests exercise the artefact that
// actually ships. MockClient from esphome-client/testing records every command,
// which is what lets us assert on the branded entity ids the plugin mints.

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';

import { MockClient } from 'esphome-client/testing';
import { ESPHomeDevice } from '../dist/device.js';

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

// MockClient covers the whole consumer surface except connect(), which is a
// transport concern it has no need for. The device only ever calls it once.
function makeClient() {
  const client = new MockClient();
  client.connect = () => {};
  return client;
}

function makePlatform() {
  return {
    platformConfig: {},
    registered: [],
    reconciled: [],
    deviceContexts: [],
    registerEntityAccessory(device, entity) {
      this.registered.push(entity);
      return `uuid-${entity.objectId}`;
    },
    reconcileDeviceAccessories(host, claimedUuids) {
      this.reconciled.push({ host, claimedUuids: [...claimedUuids] });
    },
    updateDeviceContext(host, info) {
      this.deviceContexts.push({ host, info });
    },
  };
}

function makeDevice(config = { host: '10.0.0.5' }) {
  const platform = makePlatform();
  const client = makeClient();
  const device = new ESPHomeDevice(platform, config, silentLog, () => client);
  return { device, client, platform };
}

describe('command minting', () => {
  let device;
  let client;

  beforeEach(() => {
    ({ device, client } = makeDevice());
    device.connect();
  });

  it('mints a branded switch id from the object id', () => {
    device.sendSwitchCommand('panel_switch_1', true);

    assert.equal(client.commands.length, 1);
    assert.equal(client.commands[0].id, 'switch-panel_switch_1');
    assert.deepEqual(client.commands[0].options, { state: true });
  });

  it('lowercases a mixed-case object id, matching the registry', () => {
    // The pre-2.x plugin built "{type}-{object_id}" by hand and stored it in the
    // accessory context. entityId() lowercases as it mints, so reusing that
    // stored composite would produce "switch-Panel_Switch_1" and silently miss
    // the entity. Commands must be minted from the raw object id instead.
    device.sendSwitchCommand('Panel_Switch_1', false);

    assert.equal(client.commands[0].id, 'switch-panel_switch_1');
  });

  it('mints light commands and preserves the rgb option shape', () => {
    device.sendLightCommand('LivingRoom_Lamp', { state: true, rgb: { r: 1, g: 0.5, b: 0 } });

    assert.equal(client.commands[0].id, 'light-livingroom_lamp');
    assert.deepEqual(client.commands[0].options.rgb, { r: 1, g: 0.5, b: 0 });
  });

  it('mints climate commands', () => {
    device.sendClimateCommand('office_hvac', { mode: 'heat' });

    assert.equal(client.commands[0].id, 'climate-office_hvac');
    assert.deepEqual(client.commands[0].options, { mode: 'heat' });
  });

  it('mints button commands', () => {
    device.sendButtonCommand('doorbell');

    assert.equal(client.commands[0].id, 'button-doorbell');
  });

  it('drops commands issued before connect rather than throwing', () => {
    const { device: fresh } = makeDevice();
    assert.doesNotThrow(() => fresh.sendSwitchCommand('relay', true));
  });
});

describe('entity discovery', () => {
  it('registers every advertised entity and reconciles the claimed set', () => {
    const { device, client, platform } = makeDevice();
    device.connect();

    client.emit('entities', [
      { key: 1, type: 'switch', objectId: 'relay_1', name: 'Relay 1' },
      { key: 2, type: 'light', objectId: 'lamp', name: 'Lamp' },
    ]);

    assert.deepEqual(platform.registered.map(e => e.objectId), ['relay_1', 'lamp']);
    assert.equal(platform.reconciled.length, 1);
    assert.deepEqual(platform.reconciled[0], {
      host: '10.0.0.5',
      claimedUuids: ['uuid-relay_1', 'uuid-lamp'],
    });
  });

  it('forwards device info to the platform', () => {
    const { device, client, platform } = makeDevice();
    device.connect();

    client.emit('deviceInfo', { name: 'panel', model: 'ESP32-S3', macAddress: 'aa:bb' });

    assert.equal(platform.deviceContexts.length, 1);
    assert.equal(platform.deviceContexts[0].info.model, 'ESP32-S3');
  });
});

describe('state routing', () => {
  it('routes a state event to the accessory registered under that key', () => {
    const { device, client } = makeDevice();
    device.connect();

    const seen = [];
    device.registerAccessory(7, { handleStateUpdate: d => seen.push(d), destroy() {} });

    client.emit('switch', { key: 7, state: true });

    assert.equal(seen.length, 1);
    assert.equal(seen[0].state, true);
  });

  it('ignores a state event for an unregistered key', () => {
    const { device, client } = makeDevice();
    device.connect();

    const seen = [];
    device.registerAccessory(7, { handleStateUpdate: d => seen.push(d), destroy() {} });

    assert.doesNotThrow(() => client.emit('switch', { key: 99, state: true }));
    assert.equal(seen.length, 0);
  });
});

describe('subscription lifecycle', () => {
  it('does not accumulate listeners when connect runs again on reconnect', () => {
    // connect() is re-entered by scheduleReconnect() on the same instance. In
    // esphome-client 2.x `on()` returns a Disposable rather than the client, so
    // without explicit disposal each attempt would leave the previous set live
    // and every state event would be handled once per attempt.
    const platform = makePlatform();
    const client = makeClient();
    const device = new ESPHomeDevice(platform, { host: '10.0.0.5' }, silentLog, () => client);

    device.connect();
    device.connect();
    device.connect();

    client.emit('deviceInfo', { name: 'panel' });

    assert.equal(platform.deviceContexts.length, 1,
      'handler fired once per reconnect - previous subscriptions were not disposed');
  });

  it('stops handling events after destroy', () => {
    const { device, client, platform } = makeDevice();
    device.connect();

    device.destroy();
    client.emit('deviceInfo', { name: 'panel' });
    client.emit('entities', [{ key: 1, type: 'switch', objectId: 'relay_1', name: 'Relay 1' }]);

    assert.equal(platform.deviceContexts.length, 0);
    assert.equal(platform.registered.length, 0);
  });

  it('destroys registered accessories on destroy', () => {
    const { device } = makeDevice();
    device.connect();

    let destroyed = false;
    device.registerAccessory(1, { handleStateUpdate() {}, destroy: () => { destroyed = true; } });
    device.destroy();

    assert.equal(destroyed, true);
  });
});

// Additional coverage for per-device lifecycle handling.
import { MAX_ENTITIES_PER_DEVICE } from '../dist/settings.js';
import { ESPHomePlatform } from '../dist/platform.js';
const { HomebridgeAPI } = await import(new URL('./api.js', import.meta.resolve('homebridge')));

function makeLoggedDevice() {
  const warnings = [];
  const infos = [];
  const log = { ...silentLog, warn: message => warnings.push(message), info: message => infos.push(message) };
  const platform = makePlatform();
  const client = makeClient();
  const device = new ESPHomeDevice(platform, { host: '10.0.0.5' }, log, () => client);
  return { device, client, platform, warnings, infos };
}

const relayEntities = count => Array.from({ length: count }, (_, i) => ({
  key: i + 1, type: 'switch', objectId: `relay_${i}`, name: `Relay ${i}`,
}));

const settle = () => new Promise(resolve => setImmediate(resolve));

describe('per-device lifecycle', () => {
  it('keeps running when an entity fails to register', () => {
    const { device, client, platform, warnings } = makeLoggedDevice();
    const reconcile = platform.reconcileDeviceAccessories.bind(platform);
    let prune;
    platform.reconcileDeviceAccessories = (host, claimed, enabled) => {
      prune = enabled;
      reconcile(host, claimed);
    };
    const register = platform.registerEntityAccessory.bind(platform);
    platform.registerEntityAccessory = (dev, entity) => {
      if (entity.key === 2) {
        throw new Error('registration unavailable');
      }
      return register(dev, entity);
    };
    device.connect();
    assert.doesNotThrow(() => client.emit('entities', relayEntities(3)));
    assert.deepEqual(platform.registered.map(e => e.key), [1, 3]);
    assert.deepEqual(platform.reconciled[0].claimedUuids, ['uuid-relay_0', 'uuid-relay_2']);
    assert.equal(prune, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /10\.0\.0\.5.*switch-relay_1.*registration unavailable/);
    device.destroy();
  });

  it('preserves cached accessories until a complete registration pass', () => {
    const api = new HomebridgeAPI();
    const removed = [];
    api.unregisterPlatformAccessories = (_plugin, _platform, accessories) => removed.push(...accessories);
    const platform = new ESPHomePlatform(silentLog, { platform: 'ESPHomeMDW' }, api);
    const cached = new api.platformAccessory('Relay', api.hap.uuid.generate('10.0.0.5-switch-relay_0'));
    cached.context.host = '10.0.0.5';
    platform.configureAccessory(cached);
    const client = makeClient();
    const device = new ESPHomeDevice(platform, { host: '10.0.0.5' }, silentLog, () => client);
    api.updatePlatformAccessories = () => { throw new Error('registration unavailable'); };
    device.connect();
    client.emit('entities', relayEntities(1));
    assert.equal(removed.length, 0);
    // A later complete pass can prune an accessory genuinely no longer listed.
    client.emit('entities', []);
    assert.deepEqual(removed, [cached]);
    device.destroy();
  });

  it('bounds each entity pass and preserves cached accessories on a partial pass', () => {
    const { device, client, platform, warnings } = makeLoggedDevice();
    const pruneFlags = [];
    platform.reconcileDeviceAccessories = (_host, _claimed, prune) => pruneFlags.push(prune);
    device.connect();
    for (let pass = 0; pass < 2; pass++) {
      client.emit('entities', relayEntities(MAX_ENTITIES_PER_DEVICE + 10));
      assert.equal(platform.registered.length, MAX_ENTITIES_PER_DEVICE * (pass + 1));
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /skipping 10 entities.*256/);
    }
    client.emit('entities', relayEntities(2));
    assert.equal(platform.registered.length, MAX_ENTITIES_PER_DEVICE * 2 + 2);
    assert.equal(warnings.length, 1);
    assert.deepEqual(pruneFlags, [false, false, true]);
    device.connect();
    client.emit('entities', relayEntities(MAX_ENTITIES_PER_DEVICE + 10));
    assert.equal(warnings.length, 2);
    device.destroy();
  });

  for (const type of ['sensor', 'binary_sensor', 'switch', 'light', 'climate', 'button']) {
    it(`logs a failed ${type} update and handles the next update`, () => {
      const { device, client, warnings } = makeLoggedDevice();
      let updates = 0;
      device.registerAccessory(1, { handleStateUpdate() { throw new Error('update unavailable'); }, destroy() {} });
      device.registerAccessory(2, { handleStateUpdate() { updates++; }, destroy() {} });
      device.connect();
      assert.doesNotThrow(() => client.emit(type, { key: 1 }));
      client.emit(type, { key: 2 });
      assert.equal(updates, 1);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], new RegExp(`10\\.0\\.0\\.5.*${type} key 1.*update unavailable`));
      device.destroy();
    });
  }

  it('handles a rejected connection and retries once', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { device, client, warnings, infos } = makeLoggedDevice();
    const unhandled = [];
    const onUnhandled = error => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    t.after(() => { device.destroy(); process.off('unhandledRejection', onUnhandled); });
    let attempts = 0;
    client.connect = () => {
      attempts++;
      return attempts === 1 ? Promise.reject(new Error('connection unavailable')) : Promise.resolve();
    };
    device.connect();
    await settle();
    assert.deepEqual(unhandled, []);
    assert.match(warnings[0], /10\.0\.0\.5.*connection unavailable/);
    assert.equal(infos.filter(line => line.startsWith('Reconnecting')).length, 1);
    t.mock.timers.tick(30_000);
    assert.equal(attempts, 2);
    await settle();
  });

  for (const disconnectFirst of [false, true]) {
    it(`shares one retry timer when disconnect occurs ${disconnectFirst ? 'before' : 'after'} rejection`, async t => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const { device, client, infos } = makeLoggedDevice();
      t.after(() => device.destroy());
      let attempts = 0;
      client.connect = () => {
        attempts++;
        if (attempts > 1) {
          return Promise.resolve();
        }
        if (disconnectFirst) {
          client.emit('disconnect', 'connection unavailable');
        }
        return Promise.reject(new Error('connection unavailable'));
      };
      device.connect();
      await settle();
      if (!disconnectFirst) {
        client.emit('disconnect', 'connection unavailable');
      }
      assert.equal(infos.filter(line => line.startsWith('Reconnecting')).length, 1);
      t.mock.timers.tick(30_000);
      assert.equal(attempts, 2);
      await settle();
    });
  }

  it('does not retry a pending connection after destroy', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { device, client, infos } = makeLoggedDevice();
    let reject;
    let attempts = 0;
    client.connect = () => {
      attempts++;
      return new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
    };
    device.connect();
    device.destroy();
    reject(new Error('connection unavailable'));
    await settle();
    t.mock.timers.tick(300_000);
    assert.equal(attempts, 1);
    assert.equal(infos.filter(line => line.startsWith('Reconnecting')).length, 0);
  });

  it('cancels a scheduled retry on destroy', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { device, client } = makeLoggedDevice();
    let attempts = 0;
    client.connect = () => { attempts++; return Promise.reject(new Error('connection unavailable')); };
    device.connect();
    await settle();
    device.destroy();
    t.mock.timers.tick(300_000);
    assert.equal(attempts, 1);
  });
});
