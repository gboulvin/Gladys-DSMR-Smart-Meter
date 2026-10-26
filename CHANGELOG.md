# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Changed

- Requires Gladys 5.3.0 or later: the manifest declares search keywords and
  the countries where the integration works, for the new catalog of Gladys
  5.3.
- Integration SDK 0.16.

## [1.0.3] - 2026-10-22

### Security

- `brace-expansion`, pulled in by ESLint, raised to 5.0.12 against the
  high-severity denial-of-service advisories (GHSA-mh99-v99m-4gvg and
  related). A development tool only: the published image never shipped it.
- The image is rebuilt on the latest `node:24-alpine` (Node.js and Alpine
  security patches); development tools and CI actions up to date.

## [1.0.2] - 2026-10-15

## [1.0.1] - 2026-10-15

### Fixed

- Adding the electricity meter from the Discovery tab failed with an HTTP 422
  (`t_device_feature.min cannot be null`): the "Current tariff" text feature
  now declares a minimum and a maximum, like every other feature.

## [1.0.0] - 2026-10-14

### Added

- First release of the DSMR Smart Meter integration: reads the P1 port of DSMR
  smart meters through a network P1 reader, over a raw TCP stream (P1 Wi-Fi
  dongles, ser2net) or HTTP (HomeWizard P1 meter).
- Supported variants: Netherlands (DSMR 2.2 to 5.0.2), Belgium (Fluvius
  eMUCs), Luxembourg (Smarty, encrypted telegrams decrypted with the key of the
  grid operator), Sweden and Hungary.
- Electricity meter device: consumed and injected power, per-tariff (or total)
  consumption indexes feeding the Gladys energy monitoring, injection indexes,
  voltage, current and power of each phase, current tariff, and the Belgian
  capacity-tariff registers (15-minute average demand, monthly peak).
- Gas and water meter devices, detected on the M-Bus channels of the telegram.
- Telegram CRC check: corrupted telegrams are dropped.
- Scene triggers: tariff changed, grid injection started or stopped, power
  failure detected, new monthly peak demand.
- Scene actions: read the meter, today's energy summary.
- Dashboard widgets: P1 meter overview (live power, today's totals, tariff,
  connection, power chart) and P1 meter phases (current against the fuse
  rating, voltages, sags and swells, power failures).
- "Test the connection" button in the configuration screen.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/gboulvin/Gladys-DSMR-Smart-Meter/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/gboulvin/Gladys-DSMR-Smart-Meter/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/gboulvin/Gladys-DSMR-Smart-Meter/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/gboulvin/Gladys-DSMR-Smart-Meter/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/gboulvin/Gladys-DSMR-Smart-Meter/releases/tag/v1.0.0
