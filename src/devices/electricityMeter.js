// -----------------------------------------------------------------------------
// Device type: ELECTRICITY METER (the meter the P1 port belongs to).
//
// The features are derived from the telegram itself: a single-phase Dutch
// meter, a three-phase Belgian one with its capacity-tariff registers and a
// Swedish one with totals only do not publish the same objects, and a feature
// Gladys would never receive a value for is only noise. Each descriptor below
// both declares the feature (discovery) and extracts its value (states), so the
// two can never disagree.
//
// Feature keys are forever (Gladys keys the history on them): never rename one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { PHASES, TARIFFS } from '../dsmr/parser.js';

export const DEVICE_TYPE = 'electricity-meter';

const MAX_INDEX = 1e9;
const MAX_POWER = 100_000;

/**
 * Platform id of the meter: its equipment identifier (serial number printed
 * on the meter), the header as a last resort for the oldest meters.
 */
export function meterPlatformId(reading) {
  const raw = reading.equipmentId || reading.header || 'p1-meter';
  return raw.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'p1-meter';
}

const index = (key, name, category, type, read) => ({
  key,
  name,
  category,
  type,
  unit: UNITS.KILOWATT_HOUR,
  min: 0,
  max: MAX_INDEX,
  read,
});

const power = (key, name, category, type, read) => ({
  key,
  name,
  category,
  type,
  unit: UNITS.WATT,
  min: 0,
  max: MAX_POWER,
  read,
});

/**
 * Consumption indexes. With per-tariff registers, one `energy-sensor/index`
 * per tariff (like the Linky EASF registers): Gladys derives the consumption
 * and the cost of each, which is what a day/night contract needs. A meter with
 * a total only (Sweden, Luxembourg) gets one index for it. Never both, or the
 * consumption would be counted twice.
 */
function importIndexFeatures(importIndex) {
  const tariffs = TARIFFS.filter((t) => importIndex[`t${t}`] !== undefined);
  if (tariffs.length > 0) {
    return tariffs.map((t) =>
      index(
        `import-index-t${t}`,
        `Consumption index tariff ${t}`,
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.INDEX,
        (r) => r.electricity.importIndex[`t${t}`],
      ),
    );
  }
  if (importIndex.total !== undefined) {
    return [
      index(
        'import-index-total',
        'Consumption index',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.INDEX,
        (r) => r.electricity.importIndex.total,
      ),
    ];
  }
  return [];
}

/**
 * Injection (export) indexes: energy sent back to the grid, e.g. by solar
 * panels. Grid exchange, not production: `grid-sensor/output-index`.
 */
function exportIndexFeatures(exportIndex) {
  const tariffs = TARIFFS.filter((t) => exportIndex[`t${t}`] !== undefined);
  if (tariffs.length > 0) {
    return tariffs.map((t) =>
      index(
        `export-index-t${t}`,
        `Injection index tariff ${t}`,
        CATEGORIES.GRID_SENSOR,
        TYPES.GRID_SENSOR.OUTPUT_INDEX,
        (r) => r.electricity.exportIndex[`t${t}`],
      ),
    );
  }
  if (exportIndex.total !== undefined) {
    return [
      index(
        'export-index-total',
        'Injection index',
        CATEGORIES.GRID_SENSOR,
        TYPES.GRID_SENSOR.OUTPUT_INDEX,
        (r) => r.electricity.exportIndex.total,
      ),
    ];
  }
  return [];
}

function phaseFeatures(phases) {
  const features = [];
  for (const phase of Object.keys(PHASES)) {
    const values = phases[phase];
    if (!values) continue;
    const label = phase.toUpperCase();
    if (values.voltage !== null) {
      features.push({
        key: `${phase}-voltage`,
        name: `Voltage ${label}`,
        category: CATEGORIES.ENERGY_SENSOR,
        type: TYPES.ENERGY_SENSOR.VOLTAGE,
        unit: UNITS.VOLT,
        min: 0,
        max: 500,
        read: (r) => r.electricity.phases[phase]?.voltage,
      });
    }
    if (values.current !== null) {
      features.push({
        key: `${phase}-current`,
        name: `Current ${label}`,
        category: CATEGORIES.ENERGY_SENSOR,
        type: TYPES.ENERGY_SENSOR.CURRENT,
        unit: UNITS.AMPERE,
        min: 0,
        max: 200,
        read: (r) => r.electricity.phases[phase]?.current,
      });
    }
    if (values.importPower !== null) {
      features.push(
        power(
          `${phase}-import-power`,
          `Power consumed ${label}`,
          CATEGORIES.GRID_SENSOR,
          TYPES.GRID_SENSOR.INPUT_POWER,
          (r) => r.electricity.phases[phase]?.importPower,
        ),
      );
    }
    if (values.exportPower !== null) {
      features.push(
        power(
          `${phase}-export-power`,
          `Power injected ${label}`,
          CATEGORIES.GRID_SENSOR,
          TYPES.GRID_SENSOR.OUTPUT_POWER,
          (r) => r.electricity.phases[phase]?.exportPower,
        ),
      );
    }
  }
  return features;
}

/**
 * Every feature the reading can feed, in display order.
 * @param {object} reading - Parsed telegram (src/dsmr/parser.js).
 */
export function electricityFeatures(reading) {
  const { electricity } = reading;
  const features = [];
  if (electricity.importPower !== null) {
    features.push(
      power(
        'import-power',
        'Power consumed',
        CATEGORIES.GRID_SENSOR,
        TYPES.GRID_SENSOR.INPUT_POWER,
        (r) => r.electricity.importPower,
      ),
    );
  }
  if (electricity.exportPower !== null) {
    features.push(
      power(
        'export-power',
        'Power injected',
        CATEGORIES.GRID_SENSOR,
        TYPES.GRID_SENSOR.OUTPUT_POWER,
        (r) => r.electricity.exportPower,
      ),
    );
  }
  features.push(...importIndexFeatures(electricity.importIndex));
  features.push(...exportIndexFeatures(electricity.exportIndex));
  // Belgium: the capacity tariff bills the monthly peak of the 15-minute
  // average demand.
  if (electricity.averageDemand !== null) {
    features.push(
      power(
        'average-demand',
        'Average demand (15 min)',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.POWER,
        (r) => r.electricity.averageDemand,
      ),
    );
  }
  if (electricity.monthPeakDemand !== null) {
    features.push(
      power(
        'month-peak-demand',
        'Peak demand this month',
        CATEGORIES.ENERGY_SENSOR,
        TYPES.ENERGY_SENSOR.POWER,
        (r) => r.electricity.monthPeakDemand,
      ),
    );
  }
  features.push(...phaseFeatures(electricity.phases));
  if (reading.tariff !== null) {
    features.push({
      key: 'tariff',
      name: 'Current tariff',
      category: CATEGORIES.TEXT,
      type: TYPES.TEXT.TEXT,
      text: true,
      read: (r) => r.tariff,
    });
  }
  return features;
}

export const electricityMeter = {
  key: DEVICE_TYPE,

  ids(gladys, reading) {
    return gladys.externalIds(DEVICE_TYPE, meterPlatformId(reading));
  },

  buildDevice(gladys, reading) {
    const ids = this.ids(gladys, reading);
    return {
      name: 'Electricity meter (P1)',
      external_id: ids.device,
      features: electricityFeatures(reading).map((feature) => toDiscoveredFeature(ids, feature)),
    };
  },

  states(gladys, reading) {
    const ids = this.ids(gladys, reading);
    return electricityFeatures(reading).flatMap((feature) => toStates(ids, feature, reading));
  },
};

/** Discovery payload of a feature descriptor. */
export function toDiscoveredFeature(ids, feature) {
  const payload = {
    name: feature.name,
    external_id: ids.feature(feature.key),
    category: feature.category,
    type: feature.type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  };
  if (!feature.text) {
    Object.assign(payload, { unit: feature.unit, min: feature.min, max: feature.max });
  }
  return payload;
}

/** States of a feature descriptor for a reading (none without a value). */
export function toStates(ids, feature, reading) {
  const value = feature.read(reading);
  if (value === null || value === undefined) {
    return [];
  }
  const device_feature_external_id = ids.feature(feature.key);
  return feature.text
    ? [{ device_feature_external_id, text: String(value) }]
    : [{ device_feature_external_id, state: value }];
}
