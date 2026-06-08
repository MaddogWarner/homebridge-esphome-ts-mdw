import type { PlatformAccessory, Service } from 'homebridge';
import { BaseAccessory } from './BaseAccessory.js';
import type { ESPHomePlatform } from '../platform.js';

export class ButtonAccessory extends BaseAccessory {
  private readonly switchService: Service;
  private readonly buttonIndex: number;
  private readonly eventSource: 'button' | 'switch';

  constructor(
    platform: ESPHomePlatform,
    accessory: PlatformAccessory,
    buttonIndex: number,
    subtype: string,
    displayName: string,
    eventSource: 'button' | 'switch' = 'button',
  ) {
    super(platform, accessory);
    this.buttonIndex = buttonIndex;
    this.eventSource = eventSource;

    accessory.category = this.api.hap.Categories.PROGRAMMABLE_SWITCH;

    if (!accessory.getService(this.Service.ServiceLabel)) {
      const labelService = accessory.addService(this.Service.ServiceLabel);
      labelService.setCharacteristic(
        this.Characteristic.ServiceLabelNamespace,
        this.Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS,
      );
    }

    this.switchService = accessory.getServiceById(this.Service.StatelessProgrammableSwitch, subtype)
      ?? accessory.addService(this.Service.StatelessProgrammableSwitch, displayName, subtype);

    this.switchService
      .setCharacteristic(this.Characteristic.ServiceLabelIndex, buttonIndex)
      .setCharacteristic(this.Characteristic.Name, displayName);
  }

  triggerPress(pressType: 0 | 1 | 2 = 0): void {
    this.log.debug(`Button ${this.buttonIndex} pressed (type=${pressType})`);
    this.switchService.updateCharacteristic(
      this.Characteristic.ProgrammableSwitchEvent,
      pressType,
    );
  }

  handleStateUpdate(data: unknown): void {
    if (this.eventSource === 'switch') {
      const d = data as { state?: boolean };
      if (d.state !== true) {
        return;
      }
    }

    this.triggerPress(0);
  }
}
