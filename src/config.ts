export interface EntityFilter {
  include: string[];
  exclude: string[];
}

export interface ClimateEntityConfig {
  /** ESPHome object id of the climate entity (only used in the array form). */
  objectId?: string;
  /** Expose the entity as a Thermostat (single target temperature) instead of a HeaterCooler. */
  thermostat?: boolean;
  /** Add a linked Fanv2 service for fan speed and swing. */
  fan?: boolean;
  /** Standard ESPHome presets to expose as switches, e.g. ["boost", "eco", "sleep"]. */
  presets?: string[];
  /** Custom presets to expose as switches, e.g. ["Freeze Protection"]. */
  customPresets?: string[];
}

export interface DeviceConfig {
  host: string;
  port?: number;
  encryptionKey?: string;
  password?: string;
  name?: string;
  statelessSwitches?: string[];
  entities?: Partial<EntityFilter>;
  /**
   * Per climate entity options. Either an array of { objectId, ... } (what the
   * config UI produces) or an object keyed by objectId.
   */
  climate?: ClimateEntityConfig[] | Record<string, ClimateEntityConfig>;
}

export interface ESPHomePlatformConfig {
  platform: string;
  name: string;
  discovery?: boolean;
  reconnectInterval?: number;
  devices?: DeviceConfig[];
}

export function resolveEntityFilter(config: DeviceConfig): EntityFilter {
  return {
    include: config.entities?.include ?? [],
    exclude: config.entities?.exclude ?? [],
  };
}

export function entityPassesFilter(objectId: string, filter: EntityFilter): boolean {
  if (filter.include.length > 0 && !filter.include.includes(objectId)) {
    return false;
  }

  if (filter.exclude.includes(objectId)) {
    return false;
  }

  return true;
}

export function isStatelessSwitch(objectId: string, config: DeviceConfig): boolean {
  return config.statelessSwitches?.includes(objectId) ?? false;
}

export function resolveClimateConfig(config: DeviceConfig, objectId: string): ClimateEntityConfig {
  const climate = config.climate;
  if (Array.isArray(climate)) {
    return climate.find(c => c.objectId === objectId) ?? {};
  }
  return climate?.[objectId] ?? {};
}
