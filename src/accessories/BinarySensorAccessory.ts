import type { PlatformAccessory, Service } from 'homebridge';
import { BaseAccessory } from './BaseAccessory.js';
import type { ESPHomePlatform } from '../platform.js';

export type BinarySensorClass = 'motion' | 'door' | 'window' | 'smoke' | 'generic';

export interface BinarySensorStateData {
  entity: string;
  state?: boolean;
  missingState?: boolean;
}

export class BinarySensorAccessory extends BaseAccessory {
  private readonly service: Service;

  constructor(
    platform: ESPHomePlatform,
    accessory: PlatformAccessory,
    private readonly sensorClass: BinarySensorClass,
  ) {
    super(platform, accessory);

    switch (sensorClass) {
      case 'motion':
        this.service = accessory.getService(this.Service.MotionSensor)
          ?? accessory.addService(this.Service.MotionSensor);
        break;
      case 'smoke':
        this.service = accessory.getService(this.Service.SmokeSensor)
          ?? accessory.addService(this.Service.SmokeSensor);
        break;
      case 'door':
      case 'window':
      case 'generic':
      default:
        this.service = accessory.getService(this.Service.ContactSensor)
          ?? accessory.addService(this.Service.ContactSensor);
        break;
    }

    this.service.setCharacteristic(
      this.Characteristic.Name,
      accessory.context['displayName'] as string,
    );
  }

  handleStateUpdate(data: unknown): void {
    const d = data as BinarySensorStateData;
    if (d.missingState || d.state === undefined) {
      return;
    }

    switch (this.sensorClass) {
      case 'motion':
        this.service.updateCharacteristic(this.Characteristic.MotionDetected, d.state);
        break;
      case 'smoke':
        this.service.updateCharacteristic(
          this.Characteristic.SmokeDetected,
          d.state
            ? this.Characteristic.SmokeDetected.SMOKE_DETECTED
            : this.Characteristic.SmokeDetected.SMOKE_NOT_DETECTED,
        );
        break;
      case 'door':
      case 'window':
      case 'generic':
      default:
        this.service.updateCharacteristic(
          this.Characteristic.ContactSensorState,
          d.state
            ? this.Characteristic.ContactSensorState.CONTACT_NOT_DETECTED
            : this.Characteristic.ContactSensorState.CONTACT_DETECTED,
        );
        break;
    }
  }
}
