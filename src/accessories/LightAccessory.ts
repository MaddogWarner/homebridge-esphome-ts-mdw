import { ColorMode } from 'esphome-client';
import type { PlatformAccessory, Service } from 'homebridge';
import { BaseAccessory } from './BaseAccessory.js';
import type { ESPHomePlatform } from '../platform.js';
import type { DeviceRef, LightCommandOptions } from '../device.js';

export interface LightStateData {
  entity: string;
  state?: boolean;
  brightness?: number;
  red?: number;
  green?: number;
  blue?: number;
  colorTemperature?: number;
}

export class LightAccessory extends BaseAccessory {
  private readonly service: Service;

  constructor(platform: ESPHomePlatform, accessory: PlatformAccessory) {
    super(platform, accessory);

    this.service = accessory.getService(this.Service.Lightbulb)
      ?? accessory.addService(this.Service.Lightbulb);

    this.service.setCharacteristic(
      this.Characteristic.Name,
      accessory.context['displayName'] as string,
    );

    const ref = () => accessory.context['deviceRef'] as DeviceRef | undefined;
    const entityId = () => accessory.context['entityId'] as string;

    this.service.getCharacteristic(this.Characteristic.On)
      .onSet(async (value) => {
        ref()?.sendLightCommand(entityId(), { state: value as boolean });
      });

    this.service.getCharacteristic(this.Characteristic.Brightness)
      .onSet(async (value) => {
        ref()?.sendLightCommand(entityId(), { brightness: (value as number) / 100 });
      });

    this.service.getCharacteristic(this.Characteristic.Hue)
      .onSet(async (value) => {
        const sat = (this.service.getCharacteristic(this.Characteristic.Saturation).value as number | null) ?? 100;
        ref()?.sendLightCommand(entityId(), { colorMode: ColorMode.RGB, rgb: hueSaturationToRgb(value as number, sat) });
      });

    this.service.getCharacteristic(this.Characteristic.Saturation)
      .onSet(async (value) => {
        const hue = (this.service.getCharacteristic(this.Characteristic.Hue).value as number | null) ?? 0;
        const sat = value as number;
        ref()?.sendLightCommand(entityId(), { colorMode: ColorMode.RGB, rgb: hueSaturationToRgb(hue, sat) });
      });

    this.service.getCharacteristic(this.Characteristic.ColorTemperature)
      .onSet(async (value) => {
        ref()?.sendLightCommand(entityId(), {
          colorMode: ColorMode.COLOR_TEMPERATURE,
          colorTemperature: value as number,
        });
      });
  }

  handleStateUpdate(data: unknown): void {
    const d = data as LightStateData;

    if (d.state !== undefined) {
      this.service.updateCharacteristic(this.Characteristic.On, d.state);
    }

    if (d.brightness !== undefined) {
      this.service.updateCharacteristic(this.Characteristic.Brightness, Math.round(d.brightness * 100));
    }

    if (d.colorTemperature !== undefined && d.colorTemperature > 0) {
      this.service.updateCharacteristic(this.Characteristic.ColorTemperature, clampMired(d.colorTemperature));
    }

    if (d.red !== undefined && d.green !== undefined && d.blue !== undefined) {
      const { h, s } = rgbToHueSaturation(d.red, d.green, d.blue);
      this.service.updateCharacteristic(this.Characteristic.Hue, h);
      this.service.updateCharacteristic(this.Characteristic.Saturation, s);
    }
  }
}

function clampMired(mired: number): number {
  return Math.max(50, Math.min(400, Math.round(mired)));
}

function rgbToHueSaturation(r: number, g: number, b: number): { h: number; s: number } {
  const rf = normaliseRgbChannel(r);
  const gf = normaliseRgbChannel(g);
  const bf = normaliseRgbChannel(b);
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === rf) {
      h = ((gf - bf) / delta) % 6;
    } else if (max === gf) {
      h = (bf - rf) / delta + 2;
    } else {
      h = (rf - gf) / delta + 4;
    }

    h = Math.round(h * 60);
    if (h < 0) {
      h += 360;
    }
  }

  const s = max === 0 ? 0 : Math.round((delta / max) * 100);
  return { h, s };
}

function hueSaturationToRgb(h: number, s: number): NonNullable<LightCommandOptions['rgb']> {
  const sf = s / 100;
  const c = sf;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = 1 - c;
  let rf = 0;
  let gf = 0;
  let bf = 0;

  if (h < 60) {
    rf = c;
    gf = x;
  } else if (h < 120) {
    rf = x;
    gf = c;
  } else if (h < 180) {
    gf = c;
    bf = x;
  } else if (h < 240) {
    gf = x;
    bf = c;
  } else if (h < 300) {
    rf = x;
    bf = c;
  } else {
    rf = c;
    bf = x;
  }

  return {
    r: rf + m,
    g: gf + m,
    b: bf + m,
  };
}

function normaliseRgbChannel(value: number): number {
  return value > 1 ? value / 255 : value;
}
