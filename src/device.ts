import { EspHomeClient, entityId, type CommandFor, type DeviceInfo, type ENTITY_SCHEMAS, type EspHomeClientOptions } from 'esphome-client';
import type { Entity } from 'esphome-client';
import type { Logger } from 'homebridge';
import type { ESPHomePlatform } from './platform.js';
import { isStatelessSwitch, type DeviceConfig, type EntityFilter, resolveEntityFilter } from './config.js';
import type { BaseAccessory } from './accessories/BaseAccessory.js';
import { DEFAULT_PORT, DEFAULT_RECONNECT_INTERVAL, MAX_RECONNECT_INTERVAL } from './settings.js';

// esphome-client 2.x derives every command shape from ENTITY_SCHEMAS rather than
// exposing per-entity `send*Command` wrappers, so the option types come from the
// schema table instead of `Parameters<>` on a method that no longer exists.
type CommandOptionsFor<T extends keyof typeof ENTITY_SCHEMAS> = CommandFor<(typeof ENTITY_SCHEMAS)[T]>;

export type LightCommandOptions = CommandOptionsFor<'light'>;
export type ClimateCommandOptions = CommandOptionsFor<'climate'>;

// Injection seam for tests: lets a suite drive the event and command surface
// without opening a socket. Production always takes the default.
export type ClientFactory = (options: EspHomeClientOptions) => EspHomeClient;

const defaultClientFactory: ClientFactory = (options) => new EspHomeClient(options);

// Commands take the entity's ESPHome object id, not the "{type}-{object_id}"
// composite the platform stores for display and service subtypes. esphome-client
// 2.x mints branded entity ids through `entityId()`, which lowercases as it
// builds; re-using a hand-built composite would skip that and silently miss any
// device whose object id is not already lowercase.
export interface DeviceRef {
  registerAccessory(entityKey: number, acc: BaseAccessory): void;
  sendSwitchCommand(objectId: string, state: boolean): void;
  sendLightCommand(objectId: string, opts: LightCommandOptions): void;
  sendClimateCommand(objectId: string, opts: ClimateCommandOptions): void;
  sendButtonCommand(objectId: string): void;
}

export class ESPHomeDevice implements DeviceRef {
  private client: EspHomeClient | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private currentReconnectDelay: number;
  private destroyed = false;
  // Keyed by the numeric entity key, not the id string: esphome-client emits
  // state events with `.entity` set to the friendly name (e.g. "Panel Switch 1")
  // rather than the "{type}-{object_id}" id, but `.key` is stable across both
  // the entity list and every state event.
  private readonly accessories = new Map<number, BaseAccessory>();
  private readonly entityFilter: EntityFilter;
  // esphome-client 2.x returns a Disposable from `on()` instead of the client.
  // connect() runs again on every reconnect, so without disposing these the
  // listener set grows once per attempt.
  private subscriptions: Disposable[] = [];

  constructor(
    private readonly platform: ESPHomePlatform,
    public readonly config: DeviceConfig,
    private readonly log: Logger,
    private readonly createClient: ClientFactory = defaultClientFactory,
  ) {
    this.entityFilter = resolveEntityFilter(config);
    this.currentReconnectDelay = this.baseReconnectDelay();
  }

  connect(): void {
    if (this.destroyed) {
      return;
    }

    // scheduleReconnect() calls back into connect() on the same instance, so drop
    // the previous client's listeners before wiring up a fresh set.
    this.disposeSubscriptions();

    const options: EspHomeClientOptions = {
      host: this.config.host,
      port: this.config.port ?? DEFAULT_PORT,
      clientId: 'homebridge-esphome-ts-mdw',
      logger: this.log,
      // esphome-client 2.x auto-reconnects by default. This plugin already owns a
      // reconnect loop driven by the user-facing `reconnectInterval` setting, and
      // running both would leave two schedulers racing to re-establish the same
      // connection. Adopting the library's supervisor instead would change what
      // that config option does, so it stays a separate decision.
      reconnect: false,
    };

    if (this.config.encryptionKey) {
      options.psk = this.config.encryptionKey;
    } else if (this.config.password) {
      this.log.warn(
        `Legacy password was configured for ${this.config.host}, but esphome-client `
          + 'does not expose a password option; connecting without it.',
      );
    }

    this.client = this.createClient(options);

    this.subscriptions.push(this.client.on('connect', (encrypted) => {
      this.log.info(`Connected to ${this.config.host} (encrypted=${encrypted})`);
      this.resetReconnectDelay();
    }));

    this.subscriptions.push(this.client.on('deviceInfo', (info: DeviceInfo) => {
      this.platform.updateDeviceContext(this.config.host, info);
    }));

    this.subscriptions.push(this.client.on('entities', (entities: Entity[]) => {
      const claimedUuids = new Set<string>();
      let buttonIndex = 0;
      for (const entity of entities) {
        if (entity.type === 'button' || (entity.type === 'switch' && isStatelessSwitch(entity.objectId, this.config))) {
          buttonIndex++;
        }
        const uuid = this.platform.registerEntityAccessory(this, entity, this.entityFilter, buttonIndex);
        if (uuid !== undefined) {
          claimedUuids.add(uuid);
        }
      }
      // Prune any cached accessories this device no longer advertises (migrated,
      // renamed, excluded, or left over from a previous host identity).
      this.platform.reconcileDeviceAccessories(this.config.host, claimedUuids);
    }));

    for (const eventType of ['sensor', 'binary_sensor', 'switch', 'light', 'climate', 'button'] as const) {
      this.subscriptions.push(this.client.on(eventType, (data) => {
        this.accessories.get(data.key)?.handleStateUpdate(data);
      }));
    }

    this.subscriptions.push(this.client.on('disconnect', (reason) => {
      this.log.warn(`Disconnected from ${this.config.host}: ${reason ?? 'unknown reason'}`);
      if (!this.destroyed) {
        this.scheduleReconnect();
      }
    }));

    this.client.connect();
  }

  registerAccessory(entityKey: number, acc: BaseAccessory): void {
    this.accessories.set(entityKey, acc);
  }

  sendSwitchCommand(objectId: string, state: boolean): void {
    this.client?.command(entityId('switch', objectId), { state });
  }

  sendLightCommand(objectId: string, opts: LightCommandOptions): void {
    this.client?.command(entityId('light', objectId), opts);
  }

  sendClimateCommand(objectId: string, opts: ClimateCommandOptions): void {
    this.client?.command(entityId('climate', objectId), opts);
  }

  sendButtonCommand(objectId: string): void {
    this.client?.command(entityId('button', objectId), {});
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
    this.disposeSubscriptions();
    // With auto-reconnect off, nothing else will close the socket for us.
    this.client?.disconnect();
    this.client = null;
  }

  private disposeSubscriptions(): void {
    for (const sub of this.subscriptions) {
      sub[Symbol.dispose]();
    }
    this.subscriptions = [];
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
