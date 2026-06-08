export interface EntityFilter {
  include: string[];
  exclude: string[];
}

export interface DeviceConfig {
  host: string;
  port?: number;
  encryptionKey?: string;
  password?: string;
  name?: string;
  statelessSwitches?: string[];
  entities?: Partial<EntityFilter>;
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
