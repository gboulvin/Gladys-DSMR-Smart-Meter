// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// Declared in the manifest `scene_actions` field and registered by index.js
// with `gladys.onSceneAction(key, ...)`. Both return the latest values as
// scalar `outputs` the following actions of the scene can use, e.g. a message
// "Today: {{1.0.consumption_today}} kWh, {{1.0.gas_today}} m³ of gas".
//
// Only the values the meter actually measures are returned: a meter without
// injection or gas leaves those outputs empty instead of a misleading 0.
// Throwing fails this action only (the scene logs it and continues): no
// telegram received yet is such a case.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { mbusIndex, netPower, totalExport, totalImport } from './summary.js';

const logger = createLogger({ name: 'scenes' });

function withoutEmpty(outputs) {
  return Object.fromEntries(
    Object.entries(outputs).filter(([, value]) => value !== null && value !== undefined),
  );
}

function requireReading(hub) {
  if (!hub.reading) {
    throw new Error('No telegram received from the P1 reader yet');
  }
  return hub.reading;
}

export const SCENE_ACTIONS = {
  async get_meter_readings(hub) {
    logger.info('Scene action get_meter_readings');
    const reading = requireReading(hub);
    const { electricity } = reading;
    return withoutEmpty({
      power_consumed: electricity.importPower,
      power_injected: electricity.exportPower,
      net_power: netPower(reading),
      consumption_index: totalImport(reading),
      injection_index: totalExport(reading),
      tariff: reading.tariff,
      gas_index: mbusIndex(reading, 'gas'),
      water_index: mbusIndex(reading, 'water'),
    });
  },

  async get_daily_summary(hub) {
    logger.info('Scene action get_daily_summary');
    requireReading(hub);
    const summary = hub.daily.summary();
    return withoutEmpty({
      consumption_today: summary?.consumption,
      injection_today: summary?.injection,
      gas_today: summary?.gas,
      water_today: summary?.water,
      peak_power_today: summary?.peakPower,
    });
  },
};
