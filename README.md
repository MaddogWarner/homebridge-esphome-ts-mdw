# homebridge-esphome-ts-mdw

A modern [Homebridge](https://homebridge.io) 2.0 plugin that bridges [ESPHome](https://esphome.io) devices to Apple HomeKit. Built from scratch — not a fork — with full Noise encryption support, ESM-native TypeScript, and a clean Homebridge 2.0 architecture.

## What It Does

This plugin connects ESPHome devices running the native API to Apple HomeKit via Homebridge. It auto-discovers devices on your local network using mDNS and maps ESPHome entity types to HomeKit services:

| ESPHome Entity | HomeKit Service |
| --- | --- |
| `button` | StatelessProgrammableSwitch |
| `switch` | Switch |
| `light` | Lightbulb (on/off, brightness, RGB, colour temperature) |
| `sensor` (temperature) | TemperatureSensor |
| `sensor` (humidity) | HumiditySensor |
| `binary_sensor` (motion) | MotionSensor |
| `binary_sensor` (door/window) | ContactSensor |
| `binary_sensor` (smoke) | SmokeSensor |
| `climate` | HeaterCooler |

### Primary Use Case: ESP32 Touch Panels

The primary motivation for this plugin is ESP32 multi-button touch panels. All buttons on a single ESPHome device appear as a single HomeKit accessory containing multiple programmable switch tiles — one per button. Each tile can trigger scenes, automations, or control other accessories directly from Apple Home or Siri.

```text
HomeKit Accessory: "Living Room Panel"
  ├── Button 1 → StatelessProgrammableSwitch (scene: Good Morning)
  ├── Button 2 → StatelessProgrammableSwitch (scene: Movie Time)
  └── Button 3 → StatelessProgrammableSwitch (scene: Good Night)
```

## Contributors

This plugin was designed and built by:

- **MadDogWarner** ([@maddogwarner](https://github.com/maddogwarner)) — project owner, architecture direction, requirements, and testing.
- **Claude** (Anthropic) — system architecture, technical design, ESPHome/HAP mapping decisions, code review, and documentation.
- **Codex** (OpenAI) — implementation of all TypeScript source files from the architecture specification.

## Requirements

- **Homebridge** 2.0.0 or later
- **Node.js** 22 or later
- ESPHome devices running firmware with the native API enabled (port 6053)
- Noise encryption enabled on your ESPHome devices (strongly recommended)

---

## Installation

### Via Homebridge Config UI X (recommended)

Search for `homebridge-esphome-ts-mdw` in the Homebridge plugin catalogue and install from there. The Config UI X interface provides a guided setup form.

### Via npm

```bash
npm install -g homebridge-esphome-ts-mdw
```

Then restart Homebridge.

---

## ESPHome Device Setup

### Enable the Native API with Noise Encryption

Add the following to your ESPHome device's YAML configuration:

```yaml
api:
  encryption:
    key: !secret api_encryption_key
```

Generate a random 32-byte base64 key with:

```bash
openssl rand -base64 32
```

Store the result in your ESPHome `secrets.yaml`:

```yaml
api_encryption_key: "YOUR_BASE64_KEY_HERE"
```

Flash the updated firmware to your device. The `api.encryption.key` value (the base64 string) is what you will enter as `encryptionKey` in the Homebridge configuration below.

### Multi-Button Touch Panel Example

```yaml
esphome:
  name: living-room-panel

esp32:
  board: esp32dev

api:
  encryption:
    key: !secret api_encryption_key

button:
  - platform: template
    name: "Scene Good Morning"
    id: btn_morning
    on_press:
      - logger.log: "Morning scene triggered"

  - platform: template
    name: "Scene Movie Time"
    id: btn_movie
    on_press:
      - logger.log: "Movie scene triggered"

  - platform: template
    name: "Scene Good Night"
    id: btn_night
    on_press:
      - logger.log: "Night scene triggered"
```

> All `button` entities on a single ESPHome device are grouped into one HomeKit accessory automatically. No special configuration is needed.

---

## Homebridge Configuration

### Minimal — mDNS auto-discovery only

Add the platform to your Homebridge `config.json`. With `discovery` enabled (the default), the plugin will find all ESPHome devices on your network automatically. Any device that requires an encryption key should also be listed under `devices` so the key can be provided.

```json
{
  "platform": "ESPHomeMDW",
  "name": "ESPHome"
}
```

### Full Configuration Reference

```json
{
  "platform": "ESPHomeMDW",
  "name": "ESPHome",
  "discovery": true,
  "reconnectInterval": 30,
  "devices": [
    {
      "host": "living-room-panel.local",
      "port": 6053,
      "encryptionKey": "YOUR_BASE64_KEY_HERE",
      "name": "Living Room Panel",
      "entities": {
        "include": [],
        "exclude": ["internal_button"]
      }
    },
    {
      "host": "bedroom-climate.local",
      "encryptionKey": "ANOTHER_BASE64_KEY_HERE"
    }
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | string | `"ESPHome"` | Platform display name |
| `discovery` | boolean | `true` | Auto-discover ESPHome devices via mDNS (`_esphomelib._tcp`) |
| `reconnectInterval` | integer (seconds) | `30` | Base reconnect delay. Doubles on each failure, capped at 5 minutes |
| `devices` | array | `[]` | List of devices to connect explicitly |

### Per-Device Options

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `host` | string | Yes | Hostname (e.g. `panel.local`) or IP address of the ESPHome device |
| `port` | integer | No | Native API port. Defaults to `6053` |
| `encryptionKey` | string | Recommended | Base64-encoded 32-byte PSK from `api.encryption.key` in your ESPHome YAML |
| `name` | string | No | Override the accessory display name in HomeKit |
| `entities.include` | string[] | No | Whitelist of entity `objectId` values to expose. If empty, all entities are included |
| `entities.exclude` | string[] | No | List of entity `objectId` values to hide from HomeKit |

### Entity Filtering

Entity filters use the ESPHome entity `objectId` — the snake_case identifier generated from the entity name. For example, an entity named `"Scene Good Morning"` has objectId `scene_good_morning`.

```json
"entities": {
  "include": ["btn_morning", "btn_movie"],
  "exclude": []
}
```

Setting `include` to a non-empty list exposes **only** those entities. `exclude` hides specific entities and is applied after `include`.

---

## Encryption

This plugin uses **Noise encryption** (`Noise_NNpsk0_25519_ChaChaPoly_SHA256`), the same protocol ESPHome uses in its own app and dashboard. The pre-shared key (PSK) is the base64 string from `api.encryption.key` in your ESPHome YAML.

> **Note:** Legacy plaintext API password authentication (`api.password`) is not supported by the underlying `esphome-client` library (v1.3.0). All devices should use Noise encryption. Devices configured without an `encryptionKey` will attempt a plaintext connection with no authentication.

---

## Reconnection

If a device goes offline, the plugin automatically reconnects using exponential backoff:

- First retry after `reconnectInterval` seconds (default 30 s)
- Each subsequent failure doubles the delay
- Maximum delay is 5 minutes

The delay resets to the base interval on successful reconnection.

---

## Troubleshooting

### Devices not appearing in HomeKit

- Confirm the ESPHome native API is enabled in the device YAML (`api:` block present)
- Check the device is reachable: `ping living-room-panel.local`
- Verify the `encryptionKey` matches `api.encryption.key` in your ESPHome YAML exactly
- Enable Homebridge debug logging and look for `[ESPHome]` log lines

### Buttons not triggering automations

- Ensure the button entity fires a press event in ESPHome logs
- In Apple Home, open the tile and confirm the automation is set to trigger on "Single Press"
- `ProgrammableSwitchEvent` is event-only — it does not have a readable state, which is expected behaviour

### Light colour changes not working

- RGB and colour temperature are sent as separate commands; confirm the ESPHome light entity supports the relevant colour mode
- Check ESPHome logs for any rejected light commands

### Device keeps reconnecting

- If the encryption key is wrong the connection will be refused — verify the key
- Check for network issues or DHCP address changes; using `.local` mDNS hostnames is more reliable than IP addresses

---

## Building from Source

```bash
git clone https://github.com/maddogwarner/homebridge-esphome-ts-mdw.git
cd homebridge-esphome-ts-mdw
npm install
npm run build   # compiles TypeScript to dist/
npm run lint    # ESLint check
```

---

## Licence

[Apache 2.0](LICENSE)
