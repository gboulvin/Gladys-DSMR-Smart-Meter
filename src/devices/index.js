// -----------------------------------------------------------------------------
// Device registry: everything Gladys gets from ONE reading.
//
// Unlike a fixed catalog, the devices of a P1 port depend on what is wired to
// it: the electricity meter always, a gas and/or a water meter when the
// telegram carries their M-Bus channel. These helpers derive the discovery
// payload and the states from the last parsed telegram.
// -----------------------------------------------------------------------------

import { electricityMeter } from './electricityMeter.js';
import { mbusMeter } from './mbusMeter.js';

/**
 * Discovery payload: the electricity meter, then one device per M-Bus meter.
 * @param {object} gladys - SDK instance (external ids).
 * @param {object | null} reading - Last parsed telegram.
 */
export function buildDiscoveredDevices(gladys, reading) {
  if (!reading) {
    return [];
  }
  return [
    electricityMeter.buildDevice(gladys, reading),
    ...reading.mbus.map((entry) => mbusMeter.buildDevice(gladys, reading, entry)),
  ];
}

/** Every state of a reading, in the `publishStates` format. */
export function buildStates(gladys, reading) {
  return [
    ...electricityMeter.states(gladys, reading),
    ...reading.mbus.flatMap((entry) => mbusMeter.states(gladys, reading, entry)),
  ];
}

/**
 * Signature of the device layout: when it changes (a phase or a gas meter
 * appears, the meter is replaced), the discovery list is published again.
 */
export function layoutSignature(gladys, reading) {
  return buildDiscoveredDevices(gladys, reading)
    .map((device) => `${device.external_id}[${device.features.map((f) => f.external_id)}]`)
    .join('|');
}

/** External id of the electricity meter device of a reading. */
export function electricityDeviceId(gladys, reading) {
  return electricityMeter.ids(gladys, reading).device;
}

/** External id of one feature of the electricity meter. */
export function electricityFeatureId(gladys, reading, featureKey) {
  return electricityMeter.ids(gladys, reading).feature(featureKey);
}

/** External id of the index feature of the first M-Bus meter of a kind. */
export function mbusIndexFeatureId(gladys, reading, kind) {
  const entry = reading.mbus.find((e) => e.kind === kind);
  return entry ? mbusMeter.ids(gladys, reading, entry).feature('index') : null;
}
