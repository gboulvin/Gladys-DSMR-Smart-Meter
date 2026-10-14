// -----------------------------------------------------------------------------
// Scene triggers (SDK v0.14+, Gladys 5.1+).
//
// The values themselves (power, indexes) are device features: the standard
// "device state" trigger of Gladys already covers "power above 3,000 W". The
// triggers declared here say "this happened", which a single state cannot:
//
//   - tariff_changed            the meter switched tariff (day/night, peak/off-peak);
//   - grid_direction_changed    the home started injecting into the grid (solar
//                               surplus) or consuming from it again;
//   - power_failure_detected    the meter counted a new power failure;
//   - monthly_peak_increased    a new monthly peak of the 15-minute average
//                               demand (Belgian capacity tariff).
//
// One event per transition, never one per telegram: the first reading only
// sets the baseline, and the grid direction must hold for a while before it
// counts, so a cloud passing over the panels does not fire a dozen scenes.
// -----------------------------------------------------------------------------

import { netPower } from './summary.js';

export const SCENE_TRIGGERS = {
  TARIFF_CHANGED: 'tariff_changed',
  GRID_DIRECTION_CHANGED: 'grid_direction_changed',
  POWER_FAILURE_DETECTED: 'power_failure_detected',
  MONTHLY_PEAK_INCREASED: 'monthly_peak_increased',
};

export const GRID_DIRECTIONS = { IMPORT: 'import', EXPORT: 'export' };

// How long a new grid direction must hold before the trigger fires.
export const DIRECTION_HOLD_MS = 30_000;

function directionOf(reading) {
  const net = netPower(reading);
  if (net === null || net === 0) {
    return null; // balanced or unknown: keep the current direction
  }
  return net > 0 ? GRID_DIRECTIONS.IMPORT : GRID_DIRECTIONS.EXPORT;
}

export class SceneEventDetector {
  /** @param {{ now?: () => number }} [options] */
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.previous = null;
    this.direction = null;
    this.candidate = null;
  }

  /**
   * Compare a reading with the previous one.
   * @param {object} reading - Parsed telegram.
   * @param {string} device - External id of the electricity meter device.
   * @returns {{ key: string, data: object }[]} Events to publish, in order.
   */
  update(reading, device) {
    const events = [];
    const previous = this.previous;
    this.previous = reading;
    const current = directionOf(reading);

    if (!previous) {
      this.direction = current;
      return events;
    }

    if (reading.tariff !== null && previous.tariff !== null && reading.tariff !== previous.tariff) {
      events.push({
        key: SCENE_TRIGGERS.TARIFF_CHANGED,
        data: { device, tariff: reading.tariff },
      });
    }

    const directionEvent = this.updateDirection(current, reading, device);
    if (directionEvent) events.push(directionEvent);

    const failures = reading.electricity.powerFailures;
    const longFailures = reading.electricity.longPowerFailures;
    const prevFailures = previous.electricity.powerFailures;
    const prevLong = previous.electricity.longPowerFailures;
    if (
      (failures !== null && prevFailures !== null && failures > prevFailures) ||
      (longFailures !== null && prevLong !== null && longFailures > prevLong)
    ) {
      events.push({
        key: SCENE_TRIGGERS.POWER_FAILURE_DETECTED,
        data: { device, failures: failures ?? 0, long_failures: longFailures ?? 0 },
      });
    }

    const peak = reading.electricity.monthPeakDemand;
    const prevPeak = previous.electricity.monthPeakDemand;
    // The register restarts every month: only a rise is a new peak.
    if (peak !== null && prevPeak !== null && peak > prevPeak) {
      events.push({
        key: SCENE_TRIGGERS.MONTHLY_PEAK_INCREASED,
        data: { device, peak_power: peak },
      });
    }
    return events;
  }

  updateDirection(current, reading, device) {
    if (current === null || current === this.direction) {
      this.candidate = null;
      return null;
    }
    if (this.direction === null) {
      this.direction = current;
      return null;
    }
    if (!this.candidate || this.candidate.direction !== current) {
      this.candidate = { direction: current, since: this.now() };
      return null;
    }
    if (this.now() - this.candidate.since < DIRECTION_HOLD_MS) {
      return null;
    }
    this.direction = current;
    this.candidate = null;
    const { importPower, exportPower } = reading.electricity;
    return {
      key: SCENE_TRIGGERS.GRID_DIRECTION_CHANGED,
      data: {
        device,
        direction: current,
        power: current === GRID_DIRECTIONS.EXPORT ? (exportPower ?? 0) : (importPower ?? 0),
      },
    };
  }
}
