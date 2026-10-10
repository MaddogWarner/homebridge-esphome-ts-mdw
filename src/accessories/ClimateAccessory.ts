import { ClimateAction, ClimateFanMode, ClimateMode, ClimatePreset, ClimateSwingMode } from 'esphome-client';
import type { PlatformAccessory, Service } from 'homebridge';
import { BaseAccessory } from './BaseAccessory.js';
import type { ESPHomePlatform } from '../platform.js';
import type { ClimateEntityConfig } from '../config.js';
import type { ClimateCommandOptions } from '../device.js';

export interface ClimateStateData {
  entity: string;
  mode?: number | string;
  action?: number | string;
  currentTemperature?: number | string;
  targetTemperature?: number | string;
  targetTemperatureLow?: number | string;
  targetTemperatureHigh?: number | string;
  fanMode?: number | string;
  swingMode?: number | string;
  preset?: number | string;
  customPreset?: string;
}

// Subset of the ESPHome climate entity description used to size the setpoint.
export interface ClimateEntityTraits {
  visualMinTemperature?: number;
  visualMaxTemperature?: number;
  visualTargetTemperatureStep?: number;
  supportsTwoPointTargetTemperature?: boolean;
}

type ClimateCommandMode = 'off' | 'heat_cool' | 'cool' | 'heat' | 'fan_only' | 'dry' | 'auto';
type ClimateCommandPreset = NonNullable<ClimateCommandOptions['preset']>;

const DEFAULT_RESTORE_MODE: ClimateCommandMode = 'heat_cool';
const RESTORABLE_MODES: readonly string[] = ['heat_cool', 'cool', 'heat', 'fan_only', 'dry', 'auto'];
const STANDARD_PRESETS: readonly string[] = Object.keys(ClimatePreset).map(k => k.toLowerCase()).filter(p => p !== 'none');
const CUSTOM_PREFIX = 'custom:';
// Home sends Active and the target state in one write when a mode is picked
// while the unit is off; give the mode a moment to win over the restore.
const RESTORE_DELAY_MS = 150;

interface PresetSwitch {
  key: string;
  service: Service;
}

export class ClimateAccessory extends BaseAccessory {
  private readonly service: Service;
  private readonly thermostat: boolean;
  private readonly twoPoint: boolean;
  private readonly fan?: Service;
  private readonly presetSwitches: PresetSwitch[] = [];
  private currentMode = 'off';
  private activePreset: string | null = null;
  private restoreTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    platform: ESPHomePlatform,
    accessory: PlatformAccessory,
    traits: ClimateEntityTraits = {},
    options: ClimateEntityConfig = {},
  ) {
    super(platform, accessory);

    this.thermostat = options.thermostat === true;
    this.twoPoint = !this.thermostat && traits.supportsTwoPointTargetTemperature === true;

    // Only one of the two primary services may exist; drop the other one when
    // the option is toggled so Home does not keep a stale tile around.
    const stale = this.thermostat
      ? accessory.getService(this.Service.HeaterCooler)
      : accessory.getService(this.Service.Thermostat);
    if (stale) {
      accessory.removeService(stale);
    }

    this.service = this.thermostat
      ? accessory.getService(this.Service.Thermostat) ?? accessory.addService(this.Service.Thermostat)
      : accessory.getService(this.Service.HeaterCooler) ?? accessory.addService(this.Service.HeaterCooler);

    this.service.setCharacteristic(
      this.Characteristic.Name,
      accessory.context['displayName'] as string,
    );

    const temperatureProps = {
      minValue: traits.visualMinTemperature ?? 16,
      maxValue: traits.visualMaxTemperature ?? 30,
      minStep: traits.visualTargetTemperatureStep ?? 0.5,
    };

    if (this.thermostat) {
      this.setupThermostat(temperatureProps);
    } else {
      this.setupHeaterCooler(temperatureProps);
    }

    this.fan = this.setupFan(options.fan === true);
    this.setupPresets(options);
  }

  destroy(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }

  private send(opts: ClimateCommandOptions): void {
    const objectId = this.accessory.context['entityObjectId'] as string;
    this.platform.getDeviceRef(this.accessory)?.sendClimateCommand(objectId, opts);
  }

  private get lastMode(): ClimateCommandMode {
    const stored = this.accessory.context['lastClimateMode'];
    return typeof stored === 'string' && RESTORABLE_MODES.includes(stored)
      ? stored as ClimateCommandMode
      : DEFAULT_RESTORE_MODE;
  }

  private rememberMode(mode: string): void {
    if (RESTORABLE_MODES.includes(mode)) {
      this.accessory.context['lastClimateMode'] = mode;
    }
  }

  private sendMode(mode: ClimateCommandMode): void {
    this.cancelRestore();
    this.rememberMode(mode);
    this.send({ mode });
  }

  // Power on: restore the last non-off mode, unless a mode change arrives in the same write.
  private scheduleRestore(): void {
    if (this.currentMode !== 'off') {
      return;
    }
    this.cancelRestore();
    this.restoreTimer = setTimeout(() => {
      this.restoreTimer = null;
      this.send({ mode: this.lastMode });
    }, RESTORE_DELAY_MS);
  }

  private cancelRestore(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }

  private setupHeaterCooler(props: { minValue: number; maxValue: number; minStep: number }): void {
    const C = this.Characteristic;

    this.service.getCharacteristic(C.Active)
      .onSet(async (value) => {
        if (value === C.Active.INACTIVE) {
          this.cancelRestore();
          this.send({ mode: 'off' });
        } else {
          this.scheduleRestore();
        }
      });

    this.service.getCharacteristic(C.TargetHeaterCoolerState)
      .onSet(async (value) => {
        const modeMap: Record<number, ClimateCommandMode> = {
          [C.TargetHeaterCoolerState.AUTO]: 'heat_cool',
          [C.TargetHeaterCoolerState.HEAT]: 'heat',
          [C.TargetHeaterCoolerState.COOL]: 'cool',
        };
        this.sendMode(modeMap[value as number] ?? 'heat_cool');
      });

    this.service.getCharacteristic(C.CoolingThresholdTemperature)
      .setProps(props)
      .onSet(async (value) => {
        this.send(this.twoPoint ? { targetTemperatureHigh: Number(value) } : { targetTemperature: Number(value) });
      });

    this.service.getCharacteristic(C.HeatingThresholdTemperature)
      .setProps(props)
      .onSet(async (value) => {
        this.send(this.twoPoint ? { targetTemperatureLow: Number(value) } : { targetTemperature: Number(value) });
      });
  }

  private setupThermostat(props: { minValue: number; maxValue: number; minStep: number }): void {
    const C = this.Characteristic;

    this.service.getCharacteristic(C.TargetHeatingCoolingState)
      .onSet(async (value) => {
        if (value === C.TargetHeatingCoolingState.OFF) {
          this.cancelRestore();
          this.send({ mode: 'off' });
          return;
        }
        const modeMap: Record<number, ClimateCommandMode> = {
          [C.TargetHeatingCoolingState.AUTO]: 'heat_cool',
          [C.TargetHeatingCoolingState.HEAT]: 'heat',
          [C.TargetHeatingCoolingState.COOL]: 'cool',
        };
        this.sendMode(modeMap[value as number] ?? 'heat_cool');
      });

    this.service.getCharacteristic(C.TargetTemperature)
      .setProps(props)
      .onSet(async (value) => {
        this.send({ targetTemperature: Number(value) });
      });
  }

  private setupFan(enabled: boolean): Service | undefined {
    const existing = this.accessory.getServiceById(this.Service.Fanv2, 'fan');
    if (!enabled) {
      if (existing) {
        this.accessory.removeService(existing);
      }
      return undefined;
    }

    const C = this.Characteristic;
    const name = `${this.accessory.context['displayName'] as string} Fan`;
    const fan = existing ?? this.accessory.addService(this.Service.Fanv2, name, 'fan');
    this.service.addLinkedService(fan);

    // The fan of an AC cannot run on its own: Active only mirrors the unit.
    // Turning it on powers the unit on; turning it off is ignored (Home sends
    // that together with a 0% speed, which means "auto" here).
    fan.getCharacteristic(C.Active)
      .onSet(async (value) => {
        if (value === C.Active.ACTIVE) {
          this.scheduleRestore();
        } else {
          setTimeout(() => fan.updateCharacteristic(
            C.Active,
            this.currentMode === 'off' ? C.Active.INACTIVE : C.Active.ACTIVE,
          ), 500);
        }
      });

    fan.getCharacteristic(C.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onSet(async (value) => {
        this.send({ fanMode: rotationSpeedToFanMode(Number(value)) });
      });

    fan.getCharacteristic(C.SwingMode)
      .onSet(async (value) => {
        this.send({ swingMode: value === C.SwingMode.SWING_ENABLED ? 'vertical' : 'off' });
      });

    return fan;
  }

  private setupPresets(options: ClimateEntityConfig): void {
    const keys: string[] = [];
    for (const preset of options.presets ?? []) {
      const key = preset.trim().toLowerCase();
      if (STANDARD_PRESETS.includes(key)) {
        keys.push(key);
      } else {
        this.log.warn(`Unknown climate preset "${preset}" for ${this.accessory.displayName}; ` +
          `expected one of ${STANDARD_PRESETS.join(', ')}. Use customPresets for custom ones.`);
      }
    }
    for (const preset of options.customPresets ?? []) {
      if (preset.trim() !== '') {
        keys.push(CUSTOM_PREFIX + preset.trim());
      }
    }

    const wanted = new Set(keys.map(presetSubtype));
    for (const service of [...this.accessory.services]) {
      if (service.UUID === this.Service.Switch.UUID && service.subtype?.startsWith('preset-') && !wanted.has(service.subtype)) {
        this.accessory.removeService(service);
      }
    }

    const C = this.Characteristic;
    for (const key of keys) {
      const subtype = presetSubtype(key);
      const label = presetLabel(key);
      const service = this.accessory.getServiceById(this.Service.Switch, subtype)
        ?? this.accessory.addService(this.Service.Switch, label, subtype);
      if (!service.testCharacteristic(C.ConfiguredName)) {
        service.addOptionalCharacteristic(C.ConfiguredName);
        service.setCharacteristic(C.ConfiguredName, label);
      }
      this.service.addLinkedService(service);

      service.getCharacteristic(C.On)
        .onGet(() => this.activePreset === key)
        .onSet(async (value) => {
          if (value) {
            const presetCommand: ClimateCommandOptions = key.startsWith(CUSTOM_PREFIX)
              ? { customPreset: key.slice(CUSTOM_PREFIX.length) }
              : { preset: key as ClimateCommandPreset };
            if (this.currentMode === 'off') {
              this.cancelRestore();
              this.send({ ...presetCommand, mode: this.lastMode });
            } else {
              this.send(presetCommand);
            }
            this.activePreset = key;
          } else if (this.activePreset === key) {
            this.send({ preset: 'none' });
            this.activePreset = null;
          }
          this.syncPresetSwitches();
        });

      this.presetSwitches.push({ key, service });
    }
  }

  private syncPresetSwitches(): void {
    for (const { key, service } of this.presetSwitches) {
      service.updateCharacteristic(this.Characteristic.On, this.activePreset === key);
    }
  }

  handleStateUpdate(data: unknown): void {
    const d = data as ClimateStateData;
    const C = this.Characteristic;
    const mode = normaliseClimateMode(d.mode);
    const action = normaliseClimateAction(d.action);
    const currentTemperature = normaliseNumber(d.currentTemperature);
    const targetTemperature = normaliseNumber(d.targetTemperature);

    this.currentMode = mode;
    if (mode !== 'off') {
      this.cancelRestore();
      this.rememberMode(mode);
    }

    if (this.thermostat) {
      this.updateThermostat(mode, action, targetTemperature);
    } else {
      this.updateHeaterCooler(mode, action, d);
    }

    if (currentTemperature !== undefined) {
      this.service.updateCharacteristic(C.CurrentTemperature, currentTemperature);
    }

    if (this.fan) {
      this.fan.updateCharacteristic(C.Active, mode === 'off' ? C.Active.INACTIVE : C.Active.ACTIVE);
      const fanMode = normaliseEnum(d.fanMode, ClimateFanMode);
      const speed = fanMode === undefined ? undefined : fanModeToRotationSpeed(fanMode);
      if (speed !== undefined) {
        this.fan.updateCharacteristic(C.RotationSpeed, speed);
      }
      const swing = normaliseEnum(d.swingMode, ClimateSwingMode);
      if (swing !== undefined) {
        this.fan.updateCharacteristic(
          C.SwingMode,
          swing === 'off' ? C.SwingMode.SWING_DISABLED : C.SwingMode.SWING_ENABLED,
        );
      }
    }

    if (this.presetSwitches.length > 0) {
      const customPreset = typeof d.customPreset === 'string' ? d.customPreset : '';
      const preset = normaliseEnum(d.preset, ClimatePreset);
      if (customPreset !== '') {
        this.activePreset = CUSTOM_PREFIX + customPreset;
      } else if (preset !== undefined) {
        this.activePreset = preset === 'none' ? null : preset;
      }
      this.syncPresetSwitches();
    }
  }

  private updateHeaterCooler(mode: string, action: string, d: ClimateStateData): void {
    const C = this.Characteristic;

    this.service.updateCharacteristic(
      C.Active,
      mode === 'off' ? C.Active.INACTIVE : C.Active.ACTIVE,
    );

    const currentStateMap: Record<string, number> = {
      off: C.CurrentHeaterCoolerState.INACTIVE,
      idle: C.CurrentHeaterCoolerState.IDLE,
      heating: C.CurrentHeaterCoolerState.HEATING,
      cooling: C.CurrentHeaterCoolerState.COOLING,
      fan: C.CurrentHeaterCoolerState.IDLE,
    };
    this.service.updateCharacteristic(
      C.CurrentHeaterCoolerState,
      currentStateMap[action] ?? C.CurrentHeaterCoolerState.INACTIVE,
    );

    const targetStateMap: Record<string, number> = {
      heat_cool: C.TargetHeaterCoolerState.AUTO,
      auto: C.TargetHeaterCoolerState.AUTO,
      heat: C.TargetHeaterCoolerState.HEAT,
      cool: C.TargetHeaterCoolerState.COOL,
    };
    if (mode in targetStateMap) {
      this.service.updateCharacteristic(C.TargetHeaterCoolerState, targetStateMap[mode]);
    }

    const target = normaliseNumber(d.targetTemperature);
    const low = this.twoPoint ? normaliseNumber(d.targetTemperatureLow) : target;
    const high = this.twoPoint ? normaliseNumber(d.targetTemperatureHigh) : target;
    if (high !== undefined) {
      this.service.updateCharacteristic(C.CoolingThresholdTemperature, high);
    }
    if (low !== undefined) {
      this.service.updateCharacteristic(C.HeatingThresholdTemperature, low);
    }
  }

  private updateThermostat(mode: string, action: string, targetTemperature: number | undefined): void {
    const C = this.Characteristic;

    const targetStateMap: Record<string, number> = {
      off: C.TargetHeatingCoolingState.OFF,
      heat_cool: C.TargetHeatingCoolingState.AUTO,
      auto: C.TargetHeatingCoolingState.AUTO,
      heat: C.TargetHeatingCoolingState.HEAT,
      cool: C.TargetHeatingCoolingState.COOL,
    };
    // fan_only / dry have no Thermostat equivalent: show them as AUTO so the
    // tile still reads as "on".
    this.service.updateCharacteristic(
      C.TargetHeatingCoolingState,
      targetStateMap[mode] ?? C.TargetHeatingCoolingState.AUTO,
    );

    const currentStateMap: Record<string, number> = {
      heating: C.CurrentHeatingCoolingState.HEAT,
      cooling: C.CurrentHeatingCoolingState.COOL,
    };
    this.service.updateCharacteristic(
      C.CurrentHeatingCoolingState,
      currentStateMap[action] ?? C.CurrentHeatingCoolingState.OFF,
    );

    if (targetTemperature !== undefined) {
      this.service.updateCharacteristic(C.TargetTemperature, targetTemperature);
    }
  }
}

/** HomeKit RotationSpeed (0–100 %) to ESPHome fan mode: 0 = auto, 1–33 = low, 34–66 = medium, 67–100 = high. */
export function rotationSpeedToFanMode(speed: number): 'auto' | 'low' | 'medium' | 'high' {
  if (!(speed > 0)) {
    return 'auto';
  }
  if (speed <= 33) {
    return 'low';
  }
  if (speed <= 66) {
    return 'medium';
  }
  return 'high';
}

/** ESPHome fan mode to the HomeKit RotationSpeed shown for it; undefined for modes without a sensible position. */
export function fanModeToRotationSpeed(fanMode: string): number | undefined {
  const map: Record<string, number> = {
    auto: 0,
    quiet: 33,
    low: 33,
    medium: 66,
    middle: 66,
    high: 100,
  };
  return map[fanMode];
}

function presetSubtype(key: string): string {
  return 'preset-' + key;
}

function presetLabel(key: string): string {
  if (key.startsWith(CUSTOM_PREFIX)) {
    return key.slice(CUSTOM_PREFIX.length);
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function normaliseEnum(value: number | string | undefined, values: Record<string, number>): string | undefined {
  if (typeof value === 'string') {
    return value.toLowerCase();
  }
  if (typeof value === 'number') {
    const name = Object.keys(values).find(k => values[k] === value);
    return name?.toLowerCase();
  }
  return undefined;
}

function normaliseClimateMode(mode: number | string | undefined): string {
  if (typeof mode === 'string') {
    return mode;
  }

  const modeMap: Record<number, string> = {
    [ClimateMode.OFF]: 'off',
    [ClimateMode.HEAT_COOL]: 'heat_cool',
    [ClimateMode.COOL]: 'cool',
    [ClimateMode.HEAT]: 'heat',
    [ClimateMode.FAN_ONLY]: 'fan_only',
    [ClimateMode.DRY]: 'dry',
    [ClimateMode.AUTO]: 'auto',
  };

  return modeMap[mode ?? ClimateMode.OFF] ?? 'off';
}

function normaliseClimateAction(action: number | string | undefined): string {
  if (typeof action === 'string') {
    return action;
  }

  const actionMap: Record<number, string> = {
    [ClimateAction.OFF]: 'off',
    [ClimateAction.COOLING]: 'cooling',
    [ClimateAction.HEATING]: 'heating',
    [ClimateAction.IDLE]: 'idle',
    [ClimateAction.DRYING]: 'idle',
    [ClimateAction.FAN]: 'fan',
  };

  return actionMap[action ?? ClimateAction.OFF] ?? 'off';
}

function normaliseNumber(value: number | string | undefined): number | undefined {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}
