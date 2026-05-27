import type { Entity } from 'esphome-client';
import type { PlatformAccessory } from 'homebridge';
import { ButtonAccessory } from './ButtonAccessory.js';
import { SwitchAccessory } from './SwitchAccessory.js';
import { LightAccessory } from './LightAccessory.js';
import { SensorAccessory } from './SensorAccessory.js';
import { BinarySensorAccessory, type BinarySensorClass } from './BinarySensorAccessory.js';
import { ClimateAccessory } from './ClimateAccessory.js';
import type { BaseAccessory } from './BaseAccessory.js';
import type { ESPHomePlatform } from '../platform.js';
import { entityPassesFilter, type EntityFilter } from '../config.js';

export type ESPHomeEntityInfo = Entity;

export function createAccessory(
  platform: ESPHomePlatform,
  accessory: PlatformAccessory,
  entity: ESPHomeEntityInfo,
  filter: EntityFilter,
  buttonIndex?: number,
): BaseAccessory | null {
  if (!entityPassesFilter(entity.objectId, filter)) {
    platform.log.debug(`Entity ${entity.type}-${entity.objectId} filtered out.`);
    return null;
  }

  const entityId = `${entity.type}-${entity.objectId}`;

  switch (entity.type) {
    case 'button':
      return new ButtonAccessory(
        platform,
        accessory,
        buttonIndex ?? 1,
        entityId,
        entity.name,
      );

    case 'switch':
      return new SwitchAccessory(platform, accessory);

    case 'light':
      return new LightAccessory(platform, accessory);

    case 'sensor': {
      const dc = entity.deviceClass ?? '';
      if (dc === 'temperature' || dc === 'humidity') {
        return new SensorAccessory(platform, accessory, dc);
      }
      platform.log.warn(`Unsupported sensor deviceClass "${dc}" for entity ${entityId}; skipping.`);
      return null;
    }

    case 'binary_sensor': {
      const dc = toBinarySensorClass(entity.deviceClass);
      return new BinarySensorAccessory(platform, accessory, dc);
    }

    case 'climate':
      return new ClimateAccessory(platform, accessory);

    default:
      platform.log.debug(`Unsupported entity type "${entity.type}" for ${entityId}; skipping.`);
      return null;
  }
}

function toBinarySensorClass(deviceClass: string | undefined): BinarySensorClass {
  switch (deviceClass) {
    case 'motion':
    case 'door':
    case 'window':
    case 'smoke':
      return deviceClass;
    default:
      return 'generic';
  }
}
