// -----------------------------------------------------------------------------
// Today's totals: consumption, injection, gas and water since midnight, plus
// the peak power of the day.
//
// The meter only gives cumulative indexes: the tracker remembers their value
// at the first telegram of the day and subtracts. The day is the one of the
// meter clock (the telegram timestamp), so the container time zone does not
// matter. The start values are kept in /data, the only writable volume, so a
// restart in the afternoon does not reset the day.
// -----------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { mbusIndex, totalExport, totalImport } from './summary.js';

const logger = createLogger({ name: 'daily' });

// Persist at most this often (and at every day change): a DSMR 5 meter sends
// a telegram every second, the SD card of a Raspberry Pi deserves better.
const SAVE_INTERVAL_MS = 5 * 60 * 1000;

export const DATA_DIR = process.env.DATA_DIR ?? '/data';

const round = (value, decimals) =>
  value === null ? null : Math.round(value * 10 ** decimals) / 10 ** decimals;

const difference = (current, start) =>
  current === null || start === null || start === undefined ? null : Math.max(0, current - start);

function readingTotals(reading) {
  return {
    import: totalImport(reading),
    export: totalExport(reading),
    gas: mbusIndex(reading, 'gas'),
    water: mbusIndex(reading, 'water'),
  };
}

export class DailyTracker {
  /**
   * @param {object} [options]
   * @param {string} [options.file] - Where the state is persisted.
   * @param {() => number} [options.now] - Clock (tests).
   */
  constructor({ file = `${DATA_DIR}/daily.json`, now = () => Date.now() } = {}) {
    this.file = file;
    this.now = now;
    this.state = null;
    this.current = null;
    this.lastSave = 0;
  }

  /** Load the persisted state; a missing or corrupted file starts afresh. */
  async load() {
    try {
      this.state = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.state = null;
    }
  }

  /**
   * Account for a new reading.
   * @returns {Promise<boolean>} `true` when a new day started.
   */
  async update(reading) {
    const day = reading.dayKey ?? new Date(this.now()).toISOString().slice(0, 10);
    const totals = readingTotals(reading);
    this.current = totals;
    let newDay = false;
    if (!this.state || this.state.day !== day) {
      newDay = this.state !== null;
      this.state = { day, start: totals, peakPower: 0 };
    }
    // A meter appearing during the day (gas relayed late) starts from now.
    for (const [key, value] of Object.entries(totals)) {
      if (
        value !== null &&
        (this.state.start[key] === null || this.state.start[key] === undefined)
      ) {
        this.state.start[key] = value;
      }
    }
    const power = reading.electricity.importPower;
    if (power !== null && power > this.state.peakPower) {
      this.state.peakPower = power;
    }
    if (newDay || this.now() - this.lastSave >= SAVE_INTERVAL_MS) {
      await this.save();
    }
    return newDay;
  }

  async save() {
    this.lastSave = this.now();
    try {
      await mkdir(dirname(this.file), { recursive: true });
      await writeFile(this.file, JSON.stringify(this.state));
    } catch (err) {
      // Not fatal: the day restarts from the next telegram after a restart.
      logger.warn(`Could not save the daily totals: ${err.message}`);
    }
  }

  /**
   * Today's totals, `null` values for what the meter does not measure.
   * @returns {{ day: string, consumption: number|null, injection: number|null,
   *   gas: number|null, water: number|null, peakPower: number } | null}
   */
  summary() {
    if (!this.state || !this.current) {
      return null;
    }
    const { start } = this.state;
    return {
      day: this.state.day,
      consumption: round(difference(this.current.import, start.import), 3),
      injection: round(difference(this.current.export, start.export), 3),
      gas: round(difference(this.current.gas, start.gas), 3),
      water: round(difference(this.current.water, start.water), 3),
      peakPower: this.state.peakPower,
    };
  }
}
