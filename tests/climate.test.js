// Climate accessory behaviour: setpoint/power-on commands, Thermostat option,
// linked fan (speed + swing) and preset switches.
//
// Runs against dist/ like the other suites. A real HAP Accessory stands in for
// the PlatformAccessory so service bookkeeping (subtypes, linked services,
// removal) is exercised for real; commands are captured from a fake device ref.

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { Accessory, Characteristic, Service, uuid } from '@homebridge/hap-nodejs';
import {
  ClimateAccessory,
  fanModeToRotationSpeed,
  rotationSpeedToFanMode,
} from '../dist/accessories/ClimateAccessory.js';

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, log() {} };

function makeAccessory() {
  const accessory = new Accessory('Bedroom AC', uuid.generate('test-climate'));
  accessory.context = { displayName: 'Bedroom AC', entityObjectId: 'bedroom_ac' };
  return accessory;
}

function makePlatform(commands) {
  const ref = {
    sendClimateCommand(objectId, opts) {
      commands.push({ objectId, ...opts });
    },
  };
  return {
    Service,
    Characteristic,
    log: silentLog,
    api: {},
    getDeviceRef: () => ref,
  };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function set(service, characteristic, value) {
  await service.getCharacteristic(characteristic).handleSetRequest(value);
}

describe('fan speed mapping', () => {
  it('maps 0 % to auto and the three bands to low/medium/high', () => {
    assert.equal(rotationSpeedToFanMode(0), 'auto');
    assert.equal(rotationSpeedToFanMode(1), 'low');
    assert.equal(rotationSpeedToFanMode(33), 'low');
    assert.equal(rotationSpeedToFanMode(34), 'medium');
    assert.equal(rotationSpeedToFanMode(66), 'medium');
    assert.equal(rotationSpeedToFanMode(67), 'high');
    assert.equal(rotationSpeedToFanMode(100), 'high');
  });

  it('maps fan modes back to a speed inside their band', () => {
    for (const mode of ['auto', 'low', 'medium', 'high']) {
      assert.equal(rotationSpeedToFanMode(fanModeToRotationSpeed(mode)), mode);
    }
    assert.equal(fanModeToRotationSpeed('focus'), undefined);
  });
});

describe('HeaterCooler (default)', () => {
  let commands;
  let accessory;
  let climate;
  let service;

  beforeEach(() => {
    commands = [];
    accessory = makeAccessory();
    climate = new ClimateAccessory(makePlatform(commands), accessory, { visualMinTemperature: 17, visualMaxTemperature: 30 });
    service = accessory.getService(Service.HeaterCooler);
  });

  afterEach(() => climate.destroy());

  it('keeps HeaterCooler and adds no fan or preset services by default', () => {
    assert.ok(service);
    assert.equal(accessory.getService(Service.Thermostat), undefined);
    assert.equal(accessory.getService(Service.Fanv2), undefined);
    assert.equal(accessory.services.filter(s => s.UUID === Service.Switch.UUID).length, 0);
  });

  it('sends the target temperature when a threshold changes', async () => {
    await set(service, Characteristic.CoolingThresholdTemperature, 24);
    await set(service, Characteristic.HeatingThresholdTemperature, 21.5);
    assert.deepEqual(commands, [
      { objectId: 'bedroom_ac', targetTemperature: 24 },
      { objectId: 'bedroom_ac', targetTemperature: 21.5 },
    ]);
  });

  it('restores the last non-off mode on power on', async () => {
    climate.handleStateUpdate({ mode: 'cool' });
    climate.handleStateUpdate({ mode: 'off' });
    await set(service, Characteristic.Active, Characteristic.Active.ACTIVE);
    await wait(250);
    assert.deepEqual(commands, [{ objectId: 'bedroom_ac', mode: 'cool' }]);
  });

  it('lets an explicit mode win over the restore when both arrive together', async () => {
    climate.handleStateUpdate({ mode: 'off' });
    await set(service, Characteristic.Active, Characteristic.Active.ACTIVE);
    await set(service, Characteristic.TargetHeaterCoolerState, Characteristic.TargetHeaterCoolerState.HEAT);
    await wait(250);
    assert.deepEqual(commands, [{ objectId: 'bedroom_ac', mode: 'heat' }]);
  });

  it('turns the unit off', async () => {
    climate.handleStateUpdate({ mode: 'cool' });
    await set(service, Characteristic.Active, Characteristic.Active.INACTIVE);
    assert.deepEqual(commands, [{ objectId: 'bedroom_ac', mode: 'off' }]);
  });
});

describe('Thermostat option', () => {
  it('replaces the HeaterCooler with a Thermostat and drives one setpoint', async () => {
    const commands = [];
    const accessory = makeAccessory();
    new ClimateAccessory(makePlatform(commands), accessory).destroy();
    assert.ok(accessory.getService(Service.HeaterCooler));

    const climate = new ClimateAccessory(makePlatform(commands), accessory, {}, { thermostat: true });
    const service = accessory.getService(Service.Thermostat);
    assert.ok(service);
    assert.equal(accessory.getService(Service.HeaterCooler), undefined);

    await set(service, Characteristic.TargetTemperature, 23);
    await set(service, Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.COOL);
    await set(service, Characteristic.TargetHeatingCoolingState, Characteristic.TargetHeatingCoolingState.OFF);
    assert.deepEqual(commands, [
      { objectId: 'bedroom_ac', targetTemperature: 23 },
      { objectId: 'bedroom_ac', mode: 'cool' },
      { objectId: 'bedroom_ac', mode: 'off' },
    ]);

    climate.handleStateUpdate({ mode: 'heat', action: 'heating', targetTemperature: 22 });
    assert.equal(service.getCharacteristic(Characteristic.TargetHeatingCoolingState).value,
      Characteristic.TargetHeatingCoolingState.HEAT);
    assert.equal(service.getCharacteristic(Characteristic.TargetTemperature).value, 22);
    climate.destroy();
  });
});

describe('linked fan', () => {
  let commands;
  let accessory;
  let climate;
  let fan;

  beforeEach(() => {
    commands = [];
    accessory = makeAccessory();
    climate = new ClimateAccessory(makePlatform(commands), accessory, {}, { fan: true });
    fan = accessory.getServiceById(Service.Fanv2, 'fan');
  });

  afterEach(() => climate.destroy());

  it('is linked to the climate service', () => {
    assert.ok(fan);
    assert.ok(accessory.getService(Service.HeaterCooler).linkedServices.includes(fan));
  });

  it('maps speed and swing to fan_mode / swing_mode', async () => {
    await set(fan, Characteristic.RotationSpeed, 0);
    await set(fan, Characteristic.RotationSpeed, 50);
    await set(fan, Characteristic.SwingMode, Characteristic.SwingMode.SWING_ENABLED);
    await set(fan, Characteristic.SwingMode, Characteristic.SwingMode.SWING_DISABLED);
    assert.deepEqual(commands, [
      { objectId: 'bedroom_ac', fanMode: 'auto' },
      { objectId: 'bedroom_ac', fanMode: 'medium' },
      { objectId: 'bedroom_ac', swingMode: 'vertical' },
      { objectId: 'bedroom_ac', swingMode: 'off' },
    ]);
  });

  it('does not turn the unit off when the fan is switched off', async () => {
    climate.handleStateUpdate({ mode: 'cool' });
    await set(fan, Characteristic.Active, Characteristic.Active.INACTIVE);
    assert.deepEqual(commands, []);
  });

  it('follows fan and swing state from the device', () => {
    climate.handleStateUpdate({ mode: 'cool', fanMode: 'high', swingMode: 'vertical' });
    assert.equal(fan.getCharacteristic(Characteristic.RotationSpeed).value, 100);
    assert.equal(fan.getCharacteristic(Characteristic.SwingMode).value, Characteristic.SwingMode.SWING_ENABLED);
    assert.equal(fan.getCharacteristic(Characteristic.Active).value, Characteristic.Active.ACTIVE);
  });

  it('is removed again when the option is turned off', () => {
    new ClimateAccessory(makePlatform(commands), accessory, {}, {}).destroy();
    assert.equal(accessory.getServiceById(Service.Fanv2, 'fan'), undefined);
  });
});

describe('preset switches', () => {
  let commands;
  let accessory;
  let climate;

  const sw = (key) => accessory.getServiceById(Service.Switch, `preset-${key}`);
  const on = (key) => sw(key).getCharacteristic(Characteristic.On).value;

  beforeEach(() => {
    commands = [];
    accessory = makeAccessory();
    climate = new ClimateAccessory(makePlatform(commands), accessory, {}, {
      presets: ['boost', 'Eco', 'bogus'],
      customPresets: ['Freeze Protection'],
    });
  });

  afterEach(() => climate.destroy());

  it('creates one switch per configured preset and skips unknown ones', () => {
    assert.ok(sw('boost'));
    assert.ok(sw('eco'));
    assert.ok(sw('custom:Freeze Protection'));
    assert.equal(sw('bogus'), undefined);
  });

  it('is mutually exclusive and sends preset / custom preset', async () => {
    climate.handleStateUpdate({ mode: 'cool', preset: 'none' });
    await set(sw('boost'), Characteristic.On, true);
    await set(sw('custom:Freeze Protection'), Characteristic.On, true);
    assert.equal(on('boost'), false);
    assert.equal(on('custom:Freeze Protection'), true);
    await set(sw('custom:Freeze Protection'), Characteristic.On, false);
    assert.deepEqual(commands, [
      { objectId: 'bedroom_ac', preset: 'boost' },
      { objectId: 'bedroom_ac', customPreset: 'Freeze Protection' },
      { objectId: 'bedroom_ac', preset: 'none' },
    ]);
  });

  it('powers the unit on with the last mode when a preset is picked while off', async () => {
    climate.handleStateUpdate({ mode: 'heat' });
    climate.handleStateUpdate({ mode: 'off' });
    await set(sw('eco'), Characteristic.On, true);
    assert.deepEqual(commands, [{ objectId: 'bedroom_ac', preset: 'eco', mode: 'heat' }]);
  });

  it('stays in sync with device state', () => {
    climate.handleStateUpdate({ mode: 'cool', preset: 'sleep' });
    assert.equal(on('boost'), false);
    climate.handleStateUpdate({ mode: 'cool', preset: 'eco' });
    assert.equal(on('eco'), true);
    climate.handleStateUpdate({ mode: 'heat', preset: 'none', customPreset: 'Freeze Protection' });
    assert.equal(on('eco'), false);
    assert.equal(on('custom:Freeze Protection'), true);
    climate.handleStateUpdate({ mode: 'cool', preset: 'none', customPreset: '' });
    assert.equal(on('custom:Freeze Protection'), false);
  });

  it('removes switches for presets that are no longer configured', () => {
    new ClimateAccessory(makePlatform(commands), accessory, {}, { presets: ['eco'] }).destroy();
    assert.equal(sw('boost'), undefined);
    assert.equal(sw('custom:Freeze Protection'), undefined);
    assert.ok(sw('eco'));
  });
});
