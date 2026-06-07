# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- GitHub Actions CI workflow for push and pull request validation on Node.js 22 and 24.
- GitHub Actions npm publish workflow using Trusted Publishing/OIDC provenance on GitHub Release publication.

## [1.0.1] - 2026-05-27

### Changed

- README: contributor name updated; markdown lint issues resolved.

## [1.0.0] - 2026-05-27

### Added

- Initial release.
- Homebridge 2.0 dynamic platform plugin for ESPHome devices via the native API.
- `StatelessProgrammableSwitch` for `button` entities — primary use case for ESP32 multi-button touch panels.
- Multi-button panel support: all buttons on one ESPHome device are grouped under a single HomeKit accessory with `ServiceLabel` and per-button `ServiceLabelIndex`.
- Noise encryption (`Noise_NNpsk0_25519_ChaChaPoly_SHA256`) via PSK using `esphome-client`. Legacy API password auth is not supported by `esphome-client` 1.3.0; configure `encryptionKey` instead.
- mDNS auto-discovery of ESPHome devices via `_esphomelib._tcp` using `bonjour-service`.
- Entity type mapping: `switch` → Switch, `light` → Lightbulb (brightness, RGB, colour temperature), `sensor` (temperature/humidity) → TemperatureSensor/HumiditySensor, `binary_sensor` → MotionSensor/ContactSensor/SmokeSensor, `climate` → HeaterCooler.
- Entity include/exclude filter per device.
- Exponential backoff reconnection with configurable base interval (default 30 s, capped at 5 min).
- `config.schema.json` for Homebridge Config UI X — supports guided setup with encryption key and entity filter fields.
- TypeScript 5.x strict mode, ESM-only (`"type": "module"`), `NodeNext` module resolution.
- ESLint 9 flat config with `typescript-eslint` v8.
- Apache-2.0 licence.
