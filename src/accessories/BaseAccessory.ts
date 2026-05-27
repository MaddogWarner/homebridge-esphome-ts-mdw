import type { API, Characteristic, Logger, PlatformAccessory, Service } from 'homebridge';
import type { ESPHomePlatform } from '../platform.js';

export abstract class BaseAccessory {
  protected readonly Service: typeof Service;
  protected readonly Characteristic: typeof Characteristic;
  protected readonly log: Logger;
  protected readonly api: API;

  constructor(
    protected readonly platform: ESPHomePlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    this.Service = platform.Service;
    this.Characteristic = platform.Characteristic;
    this.log = platform.log;
    this.api = platform.api;

    const infoService = this.accessory.getService(this.Service.AccessoryInformation)
      ?? this.accessory.addService(this.Service.AccessoryInformation);

    infoService
      .setCharacteristic(this.Characteristic.Manufacturer, 'ESPHome')
      .setCharacteristic(this.Characteristic.Model, accessory.context['deviceModel'] as string ?? 'ESP32')
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context['deviceMac'] as string ?? accessory.UUID)
      .setCharacteristic(this.Characteristic.FirmwareRevision, accessory.context['firmwareVersion'] as string ?? '1.0.0');
  }

  abstract handleStateUpdate(data: unknown): void;

  destroy(): void {
    // Subclasses can override when they own timers or subscriptions.
  }
}
