import { EspHomeClient, type DeviceInfo, type EspHomeClientOptions } from 'esphome-client';
import type { Entity } from 'esphome-client';
import type { Logger } from 'homebridge';
import type { ESPHomePlatform } from './platform.js';
import { type DeviceConfig, type EntityFilter, resolveEntityFilter } from './config.js';
import type { BaseAccessory } from './accessories/BaseAccessory.js';
import { DEFAULT_PORT, DEFAULT_RECONNECT_INTERVAL, MAX_RECONNECT_INTERVAL } from './settings.js';

export type LightCommandOptions = Parameters<EspHomeClient['sendLightCommand']>[1];
export type ClimateCommandOptions = Parameters<EspHomeClient['sendClimateCommand']>[1];

export interface DeviceRef {
  registerAccessory(entityId: string, acc: BaseAccessory): void;
  sendSwitchCommand(entityId: string, state: boolean): void;
  sendLightCommand(entityId: string, opts: LightCommandOptions): void;
  sendClimateCommand(entityId: string, opts: ClimateCommandOptions): void;
  sendButtonCommand(entityId: string): void;
}

export class ESPHomeDevice implements DeviceRef {
  private client: EspHomeClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentReconnectDelay: number;
  private destroyed = false;
  private readonly accessories = new Map<string, BaseAccessory>();
  private readonly entityFilter: EntityFilter;

  constructor(
    private readonly platform: ESPHomePlatform,
    public readonly config: DeviceConfig,
    private readonly log: Logger,
  ) {
    this.entityFilter = resolveEntityFilter(config);
    this.currentReconnectDelay = this.baseReconnectDelay();
  }

  connect(): void {
    if (this.destroyed) {
      return;
    }

    const options: EspHomeClientOptions = {
      host: this.config.host,
      port: this.config.port ?? DEFAULT_PORT,
      clientId: 'homebridge-esphome-ts-mdw',
      logger: this.log,
    };

    if (this.config.encryptionKey) {
      options.psk = this.config.encryptionKey;
    } else if (this.config.password) {
      this.log.warn(
        `Legacy password was configured for ${this.config.host}, but esphome-client 1.3.0 `
          + 'does not expose a password option; connecting without it.',
      );
    }

    this.client = new EspHomeClient(options);

    this.client.on('connect', ({ encrypted }) => {
      this.log.info(`Connected to ${this.config.host} (encrypted=${encrypted ?? 'unknown'})`);
      this.resetReconnectDelay();
    });

    this.client.on('deviceInfo', (info: DeviceInfo) => {
      this.platform.updateDeviceContext(this.config.host, info);
    });

    this.client.on('entities', (entities: Entity[]) => {
      let buttonIndex = 0;
      for (const entity of entities) {
        if (entity.type === 'button') {
          buttonIndex++;
        }
        this.platform.registerEntityAccessory(this, entity, this.entityFilter, buttonIndex);
      }
    });

    for (const eventType of ['sensor', 'binary_sensor', 'switch', 'light', 'climate', 'button'] as const) {
      this.client.on(eventType, (data) => {
        this.accessories.get(data.entity)?.handleStateUpdate(data);
      });
    }

    this.client.on('disconnect', (reason) => {
      this.log.warn(`Disconnected from ${this.config.host}: ${reason ?? 'unknown reason'}`);
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    });

    this.client.connect();
  }

  registerAccessory(entityId: string, acc: BaseAccessory): void {
    this.accessories.set(entityId, acc);
  }

  sendSwitchCommand(entityId: string, state: boolean): void {
    this.client?.sendSwitchCommand(entityId, state);
  }

  sendLightCommand(entityId: string, opts: LightCommandOptions): void {
    this.client?.sendLightCommand(entityId, opts);
  }

  sendClimateCommand(entityId: string, opts: ClimateCommandOptions): void {
    this.client?.sendClimateCommand(entityId, opts);
  }

  sendButtonCommand(entityId: string): void {
    this.client?.sendButtonCommand(entityId);
  }

  destroy(): void {
    this.destroyed = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    for (const acc of this.accessories.values()) {
      acc.destroy();
    }
    this.accessories.clear();
    this.client = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) {
      return;
    }

    this.log.info(`Reconnecting to ${this.config.host} in ${this.currentReconnectDelay / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.client = null;
      this.connect();
    }, this.currentReconnectDelay);
    this.currentReconnectDelay = Math.min(this.currentReconnectDelay * 2, MAX_RECONNECT_INTERVAL * 1000);
  }

  private resetReconnectDelay(): void {
    this.currentReconnectDelay = this.baseReconnectDelay();
  }

  private baseReconnectDelay(): number {
    return (this.platform.platformConfig.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL) * 1000;
  }
}
