import { ClimateAction, ClimateMode } from 'esphome-client';
import type { PlatformAccessory, Service } from 'homebridge';
import { BaseAccessory } from './BaseAccessory.js';
import type { ESPHomePlatform } from '../platform.js';
import type { DeviceRef } from '../device.js';

export interface ClimateStateData {
  entity: string;
  mode?: number | string;
  action?: number | string;
  currentTemperature?: number | string;
  targetTemperature?: number | string;
}

export class ClimateAccessory extends BaseAccessory {
  private readonly service: Service;

  constructor(platform: ESPHomePlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.service = accessory.getService(this.Service.HeaterCooler)
      ?? accessory.addService(this.Service.HeaterCooler);

    this.service.setCharacteristic(
      this.Characteristic.Name,
      accessory.context['displayName'] as string,
    );

    const ref = () => accessory.context['deviceRef'] as DeviceRef | undefined;
    const entityId = () => accessory.context['entityId'] as string;

    this.service.getCharacteristic(this.Characteristic.Active)
      .onSet(async (value) => {
        if (value === this.Characteristic.Active.INACTIVE) {
          ref()?.sendClimateCommand(entityId(), { mode: 'off' });
        }
      });

    this.service.getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .onSet(async (value) => {
        const modeMap: Record<number, 'heat_cool' | 'heat' | 'cool'> = {
          [this.Characteristic.TargetHeaterCoolerState.AUTO]: 'heat_cool',
          [this.Characteristic.TargetHeaterCoolerState.HEAT]: 'heat',
          [this.Characteristic.TargetHeaterCoolerState.COOL]: 'cool',
        };
        ref()?.sendClimateCommand(entityId(), { mode: modeMap[value as number] ?? 'heat_cool' });
      });
  }

  handleStateUpdate(data: unknown): void {
    const d = data as ClimateStateData;
    const mode = normaliseClimateMode(d.mode);
    const action = normaliseClimateAction(d.action);
    const currentTemperature = normaliseNumber(d.currentTemperature);
    const targetTemperature = normaliseNumber(d.targetTemperature);

    this.service.updateCharacteristic(
      this.Characteristic.Active,
      mode === 'off' ? this.Characteristic.Active.INACTIVE : this.Characteristic.Active.ACTIVE,
    );

    const currentStateMap: Record<string, number> = {
      off: this.Characteristic.CurrentHeaterCoolerState.INACTIVE,
      idle: this.Characteristic.CurrentHeaterCoolerState.IDLE,
      heating: this.Characteristic.CurrentHeaterCoolerState.HEATING,
      cooling: this.Characteristic.CurrentHeaterCoolerState.COOLING,
      fan: this.Characteristic.CurrentHeaterCoolerState.IDLE,
    };
    this.service.updateCharacteristic(
      this.Characteristic.CurrentHeaterCoolerState,
      currentStateMap[action] ?? this.Characteristic.CurrentHeaterCoolerState.INACTIVE,
    );

    const targetStateMap: Record<string, number> = {
      heat_cool: this.Characteristic.TargetHeaterCoolerState.AUTO,
      auto: this.Characteristic.TargetHeaterCoolerState.AUTO,
      heat: this.Characteristic.TargetHeaterCoolerState.HEAT,
      cool: this.Characteristic.TargetHeaterCoolerState.COOL,
    };
    if (mode in targetStateMap) {
      this.service.updateCharacteristic(this.Characteristic.TargetHeaterCoolerState, targetStateMap[mode]);
    }

    if (currentTemperature !== undefined) {
      this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, currentTemperature);
    }

    if (targetTemperature !== undefined) {
      this.service.updateCharacteristic(this.Characteristic.CoolingThresholdTemperature, targetTemperature);
      this.service.updateCharacteristic(this.Characteristic.HeatingThresholdTemperature, targetTemperature);
    }
  }
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
