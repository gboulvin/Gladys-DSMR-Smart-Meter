# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

**DSMR Smart Meter**, a Gladys Assistant **external integration**: a Node.js
service (Node 22+, ESM, no build step) that runs in its own sandboxed Docker
container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template
(`GladysAssistant/integration-template-js`).

It reads the **P1 port** of DSMR smart meters (Netherlands, Belgium,
Luxembourg, Sweden, Hungary) and publishes the electricity meter, plus the gas
and water meters it relays over M-Bus, as Gladys devices. The container has no
access to the host serial ports: the P1 port is always reached **through the
network** — a raw TCP stream (P1 Wi-Fi dongle, `ser2net` sharing a USB cable)
or an HTTP endpoint answering the last telegram (HomeWizard P1 meter). That is
why the manifest declares `"transports": ["local"]`.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/dsmr.test.js             # one file
node --test --test-name-pattern "Belgian" # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                     SDK wiring only: handlers registered before connect()
src/dsmr/reader.js           connection to the P1 reader (TCP stream or HTTP polling, reconnection)
src/dsmr/framer.js           byte stream -> whole telegrams (plain, or encrypted Smarty frames)
src/dsmr/decrypt.js          AES-128-GCM decryption of the Luxembourg Smarty frames
src/dsmr/crc.js              CRC16/ARC of a telegram (DSMR 4+)
src/dsmr/parser.js           telegram -> normalized reading (OBIS codes, units, M-Bus channels)
src/hub.js                   per telegram: CRC, discovery on layout change, scene events, throttled states
src/devices/                 Gladys devices derived from a reading (electricity, gas, water)
src/sceneEvents.js           scene triggers (manifest `scene_triggers`): transitions between readings
src/scenes.js                scene actions (manifest `scene_actions`)
src/widgets.js               dashboard widgets (manifest `widgets`)
src/actions.js               Configuration screen buttons (manifest `actions`)
src/daily.js                 today's totals, persisted in /data
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  the four languages, number formatting
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (mandatory)
test/                        node --test, against the SDK's fake Gladys; fixtures in test/fixtures/
.github/scripts/release.mjs  release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Devices are keyed on the meter serial number
  (`0-0:96.1.1`, `0-n:96.1.0`...), never on a label; feature keys
  (`import-index-t1`, `l2-voltage`...) are never renamed. Gladys keys devices,
  their history, scenes and dashboards on them. The same goes for every key
  users store: manifest `config_schema`, `actions`, widget and scene keys.
- **One consumption index kind per meter.** Per-tariff `energy-sensor/index`
  features when the meter has tariff registers, the total register otherwise —
  never both, or the Gladys energy monitoring counts the consumption twice.
  Grid exchange (power, injection) goes to `grid-sensor`.
- **Mind the state budget.** The host API accepts 300 states a minute and a
  DSMR 5 meter sends a telegram every second: states go through
  `publishChangedStates`, throttled to the configured refresh interval. Scene
  events fire on transitions only (one per change, never one per telegram).
- **Tests never touch the network**: real-world telegrams live in
  `test/fixtures/telegrams.js` (CRC computed by `withCrc`); a new country
  variant comes with its fixture and its parser test.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or the decryption key.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en", "fr", "de", "es" }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. Capability
  fields (`widgets`, `scene_triggers`, `scene_actions`) need
  `gladys_version >= 5.1.0`. `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers, the four languages):
  change both sides together.
- **User-facing text** is in four languages — English, French, German and
  Spanish: manifest texts, action and connection messages, widget contents and
  `docs/en.md`, `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in sync. Device
  and feature names are English (the user renames them in Gladys).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English.
