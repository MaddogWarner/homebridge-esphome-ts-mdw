import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';
import { ESPHomeDevice, type DeviceRef } from './device.js';
import { ESPHomeDiscovery } from './discovery.js';
import { entityPassesFilter, type DeviceConfig, type EntityFilter, type ESPHomePlatformConfig } from './config.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { createAccessory, type ESPHomeEntityInfo } from './accessories/AccessoryFactory.js';
import type { BaseAccessory } from './accessories/BaseAccessory.js';

export class ESPHomePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly platformConfig: ESPHomePlatformConfig;

  private readonly cachedAccessories: PlatformAccessory[] = [];
  private readonly accessoryControllers = new Map<string, BaseAccessory>();
  private readonly devices = new Map<string, ESPHomeDevice>();
  private readonly deviceInfo = new Map<string, { name?: string; esphomeVersion?: string; model?: string; macAddress?: string }>();
  private discovery: ESPHomeDiscovery | null = null;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.platformConfig = config as unknown as ESPHomePlatformConfig;

    this.log.debug('ESPHomePlatform initialising');

    this.api.on('didFinishLaunching', () => {
      this.log.debug('didFinishLaunching');
      this.discoverDevices();
    });

    this.api.on('shutdown', () => {
      this.log.debug('Shutdown: cleaning up');
      for (const dev of this.devices.values()) {
        dev.destroy();
      }
      this.discovery?.stop();
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.log.info('Restoring cached accessory:', accessory.displayName);
    this.cachedAccessories.push(accessory);
  }

  registerEntityAccessory(
    device: DeviceRef & { config: DeviceConfig },
    entity: ESPHomeEntityInfo,
    filter: EntityFilter,
    buttonIndex: number,
  ): void {
    if (!entityPassesFilter(entity.objectId, filter)) {
      this.log.debug(`Entity ${entity.type}-${entity.objectId} filtered out.`);
      return;
    }

    const entityId = `${entity.type}-${entity.objectId}`;
    const uuidSeed = entity.type === 'button'
      ? `${device.config.host}-buttons`
      : `${device.config.host}-${entityId}`;
    const uuid = this.api.hap.uuid.generate(uuidSeed);
    const entityDisplayName = entity.name || entity.objectId;
    const accessoryDisplayName = entity.type === 'button'
      ? (device.config.name ?? `${device.config.host} Buttons`)
      : entityDisplayName;

    let accessory = this.cachedAccessories.find(a => a.UUID === uuid);

    if (accessory) {
      this.log.debug(`Restoring entity ${entityId}`);
      this.updateAccessoryContext(accessory, device, entity, entityId, entityDisplayName);
      this.api.updatePlatformAccessories([accessory]);
    } else {
      this.log.debug(`Registering new entity ${entityId}`);
      accessory = new this.api.platformAccessory(accessoryDisplayName, uuid);
      this.updateAccessoryContext(accessory, device, entity, entityId, entityDisplayName);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.cachedAccessories.push(accessory);
    }

    const controllerKey = `${uuid}-${entityId}`;
    this.accessoryControllers.get(controllerKey)?.destroy();

    const acc = createAccessory(this, accessory, entity, filter, buttonIndex);
    if (acc !== null) {
      this.accessoryControllers.set(controllerKey, acc);
      device.registerAccessory(entityId, acc);
    }
  }

  updateDeviceContext(
    host: string,
    info: { name?: string; esphomeVersion?: string; model?: string; macAddress?: string },
  ): void {
    this.deviceInfo.set(host, info);

    for (const acc of this.cachedAccessories) {
      if (acc.context['host'] === host) {
        acc.context['deviceModel'] = info.model ?? 'ESP32';
        acc.context['deviceMac'] = info.macAddress ?? acc.UUID;
        acc.context['firmwareVersion'] = info.esphomeVersion ?? '1.0.0';
      }
    }
  }

  private discoverDevices(): void {
    const configDevices: DeviceConfig[] = this.platformConfig.devices ?? [];

    for (const deviceConfig of configDevices) {
      this.connectDevice(deviceConfig);
    }

    if (this.platformConfig.discovery !== false) {
      this.discovery = new ESPHomeDiscovery(this.log);
      this.discovery.start((discovered) => {
        const alreadyConfigured = configDevices.some(d => d.host === discovered.host);
        if (!alreadyConfigured) {
          this.log.info(`Auto-discovered: ${discovered.name} at ${discovered.host}:${discovered.port}`);
          this.connectDevice({ host: discovered.host, port: discovered.port, name: discovered.name });
        }
      });
    }
  }

  private connectDevice(config: DeviceConfig): void {
    if (this.devices.has(config.host)) {
      return;
    }

    const device = new ESPHomeDevice(this, config, this.log);
    this.devices.set(config.host, device);
    device.connect();
  }

  private updateAccessoryContext(
    accessory: PlatformAccessory,
    device: DeviceRef & { config: DeviceConfig },
    entity: ESPHomeEntityInfo,
    entityId: string,
    displayName: string,
  ): void {
    accessory.context['deviceRef'] = device;
    accessory.context['entityId'] = entityId;
    accessory.context['entityType'] = entity.type;
    accessory.context['entityObjectId'] = entity.objectId;
    accessory.context['displayName'] = displayName;
    accessory.context['host'] = device.config.host;

    const info = this.deviceInfo.get(device.config.host);
    if (info) {
      accessory.context['deviceModel'] = info.model ?? 'ESP32';
      accessory.context['deviceMac'] = info.macAddress ?? accessory.UUID;
      accessory.context['firmwareVersion'] = info.esphomeVersion ?? '1.0.0';
    }
  }
}
