export const PLATFORM_NAME = 'ESPHomeMDW';
export const PLUGIN_NAME = 'homebridge-esphome-ts-mdw';

export const DEFAULT_PORT = 6053;
export const DEFAULT_RECONNECT_INTERVAL = 30;
export const MAX_RECONNECT_INTERVAL = 300;

// Allow grouped button entities beyond a single bridge's accessory capacity,
// while bounding registration work per device. Normal fixtures use two entities.
export const MAX_ENTITIES_PER_DEVICE = 256;
