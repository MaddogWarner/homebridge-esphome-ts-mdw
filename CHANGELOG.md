# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-09-12

> Minimum Node.js is now **22.20**. Installs on Node 22.0–22.19 will be refused by npm; upgrade Node before updating the plugin. Nothing else about your configuration or your HomeKit accessories changes.

### Changed

- Migrated to `esphome-client` 2.0.0. The per-entity `send*Command` wrappers were removed upstream in favour of a single `client.command(id, options)` entry point taking a branded `EntityId`, and `client.on()` now returns a `Disposable` instead of the client. Behaviour is unchanged for users.
- Commands are now addressed by the entity's ESPHome object id rather than the `{type}-{object_id}` composite stored in the accessory context. Upstream's `entityId()` lowercases as it mints, so a device with a mixed-case object id would not have matched the registry had the stored composite been reused.
- Minimum Node.js is now 22.20, matching `esphome-client` 2.0.0. The declared range was previously `^22`, which permitted versions the new dependency does not support.
- Auto-reconnect is explicitly disabled on the client (`reconnect: false`). `esphome-client` 2.x reconnects by default, and the plugin already has its own loop driven by the `reconnectInterval` setting; leaving both enabled would have run two schedulers against one connection.

### Fixed

- Event listeners are now disposed when a device reconnects or shuts down. Under the 2.x `Disposable` subscription model each reconnect would otherwise have added a further set of listeners, so a state event would be handled once per reconnect attempt.
- A device shutdown now closes its connection rather than only dropping the client reference, so the socket is not left open.

### Added

- A test suite covering command minting (including the mixed-case object id case), entity discovery, state routing by entity key, and subscription disposal. Runs on `node --test` against the built output, using `MockClient` from `esphome-client/testing`; no new dependencies. CI now runs it on Node 22 and 24.
- Repository security baseline, accumulated since 1.1.1 and unreleased until now: Dependabot, CodeQL analysis, dependency review, secret scanning via gitleaks, a stale-issue workflow and CODEOWNERS, plus the dependency and GitHub Actions updates those raised. No runtime impact.

## [1.1.1] - 2026-06-08

### Fixed

- Stale HomeKit accessories are now reliably removed. Previously cleanup only handled a stateful switch being migrated to a stateless button, and only when its cached UUID matched the current device host — so orphaned tiles could linger after a stateful→stateless migration, an entity rename or exclusion, or a device switching between its mDNS hostname and a configured IP. The plugin now reconciles each device's cached accessories against its live entity list after every successful connection and unregisters any that are no longer advertised. Offline devices are never pruned (reconciliation runs only after a device reports its entities).

### Changed

- Replaced the narrow stateful-switch migration cleanup with the general reconciliation pass. Stale accessories are matched by host, and by device MAC for cross-identity orphans, without ever reclaiming accessories owned by another currently-active device.

## [1.1.0] - 2026-06-08

### Added

- Added per-device `statelessSwitches` configuration. Listed ESPHome switch `objectId` values are exposed as HomeKit `StatelessProgrammableSwitch` services and emit a single-press event on ON telemetry.
- Added Config UI X schema and README documentation for migrating LVGL/template-switch touch panels to stateless HomeKit button tiles.

### Changed

- Configured stateless switches now share the existing programmable-switch accessory grouping with native ESPHome button entities. Unconfigured switches continue to expose as normal HomeKit `Switch` accessories.
- Migrated stateless switches remove stale cached stateful switch accessories to avoid duplicate Apple Home tiles after changing mode.

### Verified

- Built, linted, and completed an npm package dry-run for the `1.1.0` stateless switch feature.

## [1.0.4] - 2026-06-07

### Fixed

- Switch entities now update HomeKit to OFF when ESPHome emits a keyed switch event without an explicit boolean `state` field. This covers device-side template switch toggles where protobuf default false values may be omitted from the state payload.

## [1.0.3] - 2026-06-07

### Fixed

- Entity state changes now reach HomeKit. State events were routed by the `{type}-{object_id}` id, but `esphome-client` emits state events with `entity` set to the friendly name (e.g. `Panel Switch 1`) rather than the id, so the lookup always missed and on-device changes were never reflected. Routing now uses the stable numeric entity `key`, which is present on both the entity list and every state event — so a physical touch-panel button press (or any device-side change) updates the HomeKit accessory.

## [1.0.2] - 2026-06-07

### Fixed

- Auto-discovery no longer opens a second, unencrypted connection to a device that is already configured by IP when mDNS advertises it by hostname. Discovered devices are now matched against configured hosts by both hostname and resolved IP addresses.
- Accessories persist across restarts again. The live device handle was stored in the HomeKit accessory context, which Homebridge serialises to disk — causing "Do not know how to serialize a BigInt" and circular-structure errors. It is now held outside the serialised context and resolved via the platform.

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
