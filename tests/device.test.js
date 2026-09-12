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
