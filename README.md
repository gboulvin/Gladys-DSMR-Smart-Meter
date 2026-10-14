# DSMR Smart Meter — Gladys Assistant integration

External integration for [Gladys Assistant](https://gladysassistant.com) that
reads **DSMR smart meters through their P1 port**: electricity consumption and
injection, per-phase measurements, and the **gas and water meters** relayed by
the electricity meter. Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and SDK [`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

- **Local only** (`"transports": ["local"]`): no cloud, no account, the
  telegrams never leave your network.
- Four languages: English, French, German, Spanish.
- Requires **Gladys 5.1.0** or later (scene triggers, scene actions, widgets).

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Countries and meters

The P1 port is defined by the Dutch **DSMR** standard (Dutch Smart Meter
Requirements, _P1 Companion Standard_). Several countries adopted it, with
their own variants, all supported:

| Country        | Meters                                                                                                                             | Specifics handled by the integration                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 🇳🇱 Netherlands | Every smart meter since 2008: DSMR 2.2, 3.0, 4.x, 5.0.2 (Landis+Gyr, Kaifa, Iskra, Sagemcom, Kamstrup…)                            | Two tariffs (low/normal), gas meter on M-Bus, DSMR 2.2/3.0 telegrams without CRC                |
| 🇧🇪 Belgium     | Digital meters of Fluvius (Flanders), Sibelga (Brussels), ORES and RESA (Wallonia) — P1 port to activate with the grid operator    | Day/night tariffs, gas on `24.2.3`, **capacity tariff** registers (15-min demand, monthly peak) |
| 🇱🇺 Luxembourg  | **Smarty** meters                                                                                                                  | **Encrypted** telegrams (AES-128-GCM): decryption key to request from Creos                     |
| 🇸🇪 Sweden      | Meters with a **HAN port** following the Swedish recommendation based on DSMR P1 5.0.2 (activated on request by the grid operator) | Totals only (no tariff registers), three phases                                                 |
| 🇭🇺 Hungary     | E.ON and MVM smart meters with a P1 port                                                                                           | Several tariff registers (`1.8.1` to `1.8.4`)                                                   |

**Not compatible** — these meters speak another protocol: France (Linky:
_Télé-Information Client_, see the Gladys teleinformation integrations),
Germany (SML on the optical interface), Spain, Austria and Switzerland (DLMS
customer interfaces), Norway and Denmark (DLMS/Kamstrup HAN ports).

## Compatible P1 readers

The integration runs in a sandboxed container **without access to the host
serial ports**: it reads the P1 port through the network. Any reader offering
one of these two modes works:

| Mode                 | Examples                                                                                                                                                                                                                                               | Setting                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **TCP** (raw stream) | Wi-Fi/Ethernet P1 dongles offering a "raw telegram over TCP" (socket, telnet) mode; ESPHome `stream_server`; Tasmota serial bridge (`TCPStart`); a **USB P1 cable** plugged into any computer — the Gladys host included — and shared with **ser2net** | IP address + port             |
| **HTTP**             | **HomeWizard Wi-Fi P1 meter** (enable the _local API_ in the HomeWizard app); any reader answering the raw telegram on an URL                                                                                                                          | `http://<ip>/api/v1/telegram` |

USB P1 cable shared with ser2net (v4, YAML configuration, DSMR 4/5 at
115200 baud — use `9600e71` for DSMR 2.2/3.0):

```yaml
connection: &p1
  accepter: tcp,2001
  connector: serialdev,/dev/ttyUSB0,115200n81,local
  options:
    kickolduser: true
```

Then configure the integration with the IP address of that computer and port
`2001`.

## What you get

| Device                 | Features                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electricity meter (P1) | Power consumed / injected (`grid-sensor`), consumption index per tariff or total (`energy-sensor/index`, feeds the Gladys energy monitoring and costs), injection indexes, voltage / current / power per phase, current tariff, Belgian average and monthly peak demand |
| Gas meter (P1)         | Gas index (m³)                                                                                                                                                                                                                                                          |
| Water meter (P1)       | Water index (m³)                                                                                                                                                                                                                                                        |

Only the features the meter actually reports are created. Devices are keyed on
the meter serial numbers.

**Scene triggers** — _Electricity tariff changed_, _Grid injection started or
stopped_ (held 30 s, ideal to start appliances on solar surplus), _Power
failure detected_, _New monthly peak demand_ (Belgian capacity tariff).

**Scene actions** — _Read the P1 meter_ (power, indexes, tariff, gas, water as
scene variables) and _Today's energy summary_ (today's consumption, injection,
gas, water, peak power).

**Dashboard widgets** — _P1 meter overview_ (live power tiles, today's totals,
tariff, connection, power chart) and _P1 meter phases_ (current gauges scaled
to your fuse rating, voltages, voltage sags/swells, power failures).

**Configuration screen** — _Test the connection_ button: waits for the next
telegram and describes the meter.

## Development

```bash
npm install
npm test               # node --test (fixtures for every country variant)
npm run lint           # ESLint
npm run format:check   # Prettier
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="dsmr-smart-meter" \
DATA_DIR=./data LOG_LEVEL=debug \
npm start
```

See [`CLAUDE.md`](CLAUDE.md) for the architecture and the project rules, and
[`SECURITY.md`](SECURITY.md) to report a vulnerability.

## Release

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md),
then **Actions → Release → Run workflow** (`patch`, `minor` or `major`): the
workflow bumps the version in `package.json` and the manifest, rolls the
changelog, tags, builds the `linux/amd64` + `linux/arm64` image to
`ghcr.io/gboulvin/gladys-dsmr-smart-meter` and publishes the GitHub Release.
The Gladys integration store picks up the new manifest version.

Before publishing, the store checks can be run locally:

```bash
npx github:GladysAssistant/integration-store .
```

The repository must carry the GitHub topic `gladys-assistant-integration`
(repository **About** → topics): it is how the decentralized store indexer
finds it. The `ghcr.io` package must be public.

## License

Apache-2.0
