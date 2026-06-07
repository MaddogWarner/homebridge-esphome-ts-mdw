import type { PlatformAccessory, Service } from 'homebridge';
import { BaseAccessory } from './BaseAccessory.js';
import type { ESPHomePlatform } from '../platform.js';

export interface SwitchStateData {
  entity: string;
  state?: boolean;
}

export class SwitchAccessory extends BaseAccessory {
  private readonly service: Service;

  constructor(platform: ESPHomePlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.service = accessory.getService(this.Service.Switch)
      ?? accessory.addService(this.Service.Switch);

    this.service.setCharacteristic(
      this.Characteristic.Name,
      accessory.context['displayName'] as string,
    );

    this.service.getCharacteristic(this.Characteristic.On)
      .onSet(async (value) => {
        const ref = this.platform.getDeviceRef(accessory);
        ref?.sendSwitchCommand(accessory.context['entityId'] as string, value as boolean);
      });
  }

  handleStateUpdate(data: unknown): void {
    const d = data as SwitchStateData;
    const state = d.state ?? false;
    const displayName = this.accessory.context['displayName'] as string;

    this.log.debug(`Switch ${displayName} state update: ${state ? 'ON' : 'OFF'}`);
    this.service.updateCharacteristic(this.Characteristic.On, state);
  }
}
