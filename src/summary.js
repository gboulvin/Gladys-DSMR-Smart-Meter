// -----------------------------------------------------------------------------
// Totals of a reading, whatever the country variant: the sum of the tariff
// registers when the meter has some, its total register otherwise.
// -----------------------------------------------------------------------------

import { TARIFFS } from './dsmr/parser.js';

function indexTotal(registers) {
  const tariffs = TARIFFS.map((t) => registers[`t${t}`]).filter((v) => v !== undefined);
  if (tariffs.length > 0) {
    return Math.round(tariffs.reduce((sum, v) => sum + v, 0) * 1000) / 1000;
  }
  return registers.total ?? null;
}

/** Total consumed energy, kWh. */
export const totalImport = (reading) => indexTotal(reading.electricity.importIndex);

/** Total injected energy, kWh. */
export const totalExport = (reading) => indexTotal(reading.electricity.exportIndex);

/** Index of the first M-Bus meter of a kind ('gas' | 'water'), m³. */
export const mbusIndex = (reading, kind) =>
  reading.mbus.find((entry) => entry.kind === kind)?.value ?? null;

/**
 * Net grid power, W: positive when consuming, negative when injecting.
 * `null` when the meter reports no power at all.
 */
export function netPower(reading) {
  const { importPower, exportPower } = reading.electricity;
  if (importPower === null && exportPower === null) {
    return null;
  }
  return (importPower ?? 0) - (exportPower ?? 0);
}
