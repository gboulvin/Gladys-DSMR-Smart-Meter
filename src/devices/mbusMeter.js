// -----------------------------------------------------------------------------
// Device types: GAS METER and WATER METER.
//
// In the Netherlands and Belgium the gas meter (and sometimes a water meter)
// talks to the electricity meter over a wireless M-Bus link; the electricity
// meter relays its index in the P1 telegram (0-n:24.2.1, n = M-Bus channel).
// Each one becomes its own Gladys device, keyed on its own serial number, so
// replacing the electricity meter does not orphan the gas history.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { meterPlatformId, toDiscoveredFeature, toStates } from './electricityMeter.js';

export const MBUS_DEVICE_TYPES = { gas: 'gas-meter', water: 'water-meter' };

const NAMES = {
  gas: { device: 'Gas meter (P1)', index: 'Gas index' },
  water: { device: 'Water meter (P1)', index: 'Water index' },
};

/**
 * Platform id of an M-Bus meter: its own equipment id when the telegram
 * carries one, else the electricity meter id plus the channel.
 */
export function mbusPlatformId(reading, entry) {
  const own = (entry.equipmentId ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return own || `${meterPlatformId(reading)}-ch${entry.channel}`;
}

function indexFeature(entry) {
  return {
    key: 'index',
    name: NAMES[entry.kind].index,
    category: CATEGORIES.VOLUME_SENSOR,
    type: TYPES.VOLUME_SENSOR.DECIMAL,
    unit: UNITS.CUBIC_METER,
    min: 0,
    max: 1e8,
    read: (reading) => reading.mbus.find((e) => e.channel === entry.channel)?.value,
  };
}

export const mbusMeter = {
  key: 'mbus-meter',

  ids(gladys, reading, entry) {
    return gladys.externalIds(MBUS_DEVICE_TYPES[entry.kind], mbusPlatformId(reading, entry));
  },

  buildDevice(gladys, reading, entry) {
    const ids = this.ids(gladys, reading, entry);
    return {
      name: NAMES[entry.kind].device,
      external_id: ids.device,
      features: [toDiscoveredFeature(ids, indexFeature(entry))],
    };
  },

  states(gladys, reading, entry) {
    return toStates(this.ids(gladys, reading, entry), indexFeature(entry), reading);
  },
};
