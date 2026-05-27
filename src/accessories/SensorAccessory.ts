import type { PlatformAccessory, Service } from 'homebridge';
import { BaseAccessory } from './BaseAccessory.js';
import type { ESPHomePlatform } from '../platform.js';

export interface SensorStateData {
  entity: string;
  state?: number;
  missingState?: boolean;
}

export class SensorAccessory extends BaseAccessory {
  private readonly service: Service;

  constructor(
    platform: ESPHomePlatform,
    accessory: PlatformAccessory,
    private readonly sensorType: 'temperature' | 'humidity',
  ) {
    super(platform, accessory);

    this.service = sensorType === 'temperature'
      ? (accessory.getService(this.Service.TemperatureSensor) ?? accessory.addService(this.Service.TemperatureSensor))
      : (accessory.getService(this.Service.HumiditySensor) ?? accessory.addService(this.Service.HumiditySensor));

    this.service.setCharacteristic(
      this.Characteristic.Name,
      accessory.context['displayName'] as string,
    );
  }

  handleStateUpdate(data: unknown): void {
    const d = data as SensorStateData;
    if (d.missingState || d.state === undefined) {
      return;
    }

    if (this.sensorType === 'temperature') {
      this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, d.state);
    } else {
      this.service.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, d.state);
    }
  }
}
