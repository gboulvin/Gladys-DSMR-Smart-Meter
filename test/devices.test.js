import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { parseTelegram } from '../src/dsmr/parser.js';
import { buildDiscoveredDevices, buildStates, layoutSignature } from '../src/devices/index.js';
import { BE_FLUVIUS, LU_SMARTY, NL_DSMR22, NL_DSMR5, SE_TOTALS } from './fixtures/telegrams.js';

const VARIANTS = { NL_DSMR5, BE_FLUVIUS, SE_TOTALS, NL_DSMR22, LU_SMARTY };

const featuresOf = (device) => device.features.map((f) => f.external_id.split(':').at(-1));

for (const [name, telegram] of Object.entries(VARIANTS)) {
  test(`${name}: Gladys accepts the discovered devices and every state`, async () => {
    // The SDK fake refuses what the host API refuses (category, type, unit,
    // external id prefix...): a refusal would be a 400 for the whole list.
    const gladys = createFakeGladys();
    const reading = parseTelegram(telegram);
    const devices = buildDiscoveredDevices(gladys, reading);
    await gladys.publishDiscoveredDevices(devices);
    assert.equal(gladys.fake.discoveredDevices.length, devices.length);

    const states = buildStates(gladys, reading);
    await gladys.publishStates(states);
    const featureIds = new Set(devices.flatMap((d) => d.features.map((f) => f.external_id)));
    for (const state of states) {
      assert.ok(featureIds.has(state.device_feature_external_id), 'state of a published feature');
    }
    // Every published feature receives a value from this telegram.
    const withState = new Set(states.map((s) => s.device_feature_external_id));
    assert.deepEqual(
      [...featureIds].filter((id) => !withState.has(id)),
      [],
    );
  });

  test(`${name}: external ids are unique and only one kind of consumption index`, () => {
    const gladys = createFakeGladys();
    const devices = buildDiscoveredDevices(gladys, parseTelegram(telegram));
    const ids = devices.flatMap((d) => [d.external_id, ...d.features.map((f) => f.external_id)]);
    assert.equal(new Set(ids).size, ids.length);
    // Per-tariff indexes OR a total, never both: Gladys would count it twice.
    const indexes = featuresOf(devices[0]).filter((key) => key.startsWith('import-index'));
    assert.ok(indexes.length > 0, 'the consumption is published');
    assert.ok(
      indexes.every((key) => key === 'import-index-total') ||
        indexes.every((key) => key !== 'import-index-total'),
      `mixed indexes: ${indexes}`,
    );
  });
}

test('a Dutch DSMR 5 meter: electricity with three phases, plus the gas meter', () => {
  const gladys = createFakeGladys();
  const [electricity, gas] = buildDiscoveredDevices(gladys, parseTelegram(NL_DSMR5));
  assert.equal(electricity.external_id, 'ext:test-integration:electricity-meter:K8EG004046395507');
  assert.deepEqual(featuresOf(electricity), [
    'import-power',
    'export-power',
    'import-index-t1',
    'import-index-t2',
    'export-index-t1',
    'export-index-t2',
    'l1-voltage',
    'l1-current',
    'l1-import-power',
    'l1-export-power',
    'l2-voltage',
    'l2-current',
    'l2-import-power',
    'l2-export-power',
    'l3-voltage',
    'l3-current',
    'l3-import-power',
    'l3-export-power',
    'tariff',
  ]);
  const index = electricity.features.find((f) => f.external_id.endsWith(':import-index-t1'));
  assert.equal(index.category, CATEGORIES.ENERGY_SENSOR);
  assert.equal(index.type, TYPES.ENERGY_SENSOR.INDEX, 'feeds the Gladys energy monitoring');
  const power = electricity.features.find((f) => f.external_id.endsWith(':import-power'));
  assert.equal(power.category, CATEGORIES.GRID_SENSOR);
  assert.equal(power.type, TYPES.GRID_SENSOR.INPUT_POWER);
  assert.equal(gas.external_id, 'ext:test-integration:gas-meter:2222ABCD123456789');
  assert.equal(gas.features[0].category, CATEGORIES.VOLUME_SENSOR);
  assert.equal(gas.features[0].unit, 'cubicmeter');
});

test('a Belgian meter publishes its capacity-tariff registers', () => {
  const gladys = createFakeGladys();
  const [electricity] = buildDiscoveredDevices(gladys, parseTelegram(BE_FLUVIUS));
  const keys = featuresOf(electricity);
  assert.ok(keys.includes('average-demand'));
  assert.ok(keys.includes('month-peak-demand'));
});

test('a meter with totals only gets one consumption index', () => {
  const gladys = createFakeGladys();
  const [electricity] = buildDiscoveredDevices(gladys, parseTelegram(SE_TOTALS));
  assert.ok(featuresOf(electricity).includes('import-index-total'));
  assert.ok(featuresOf(electricity).includes('export-index-total'));
  assert.ok(!featuresOf(electricity).includes('tariff'), 'no tariff register, no feature');
  assert.equal(
    electricity.external_id,
    'ext:test-integration:electricity-meter:ELL5-253833635_A',
    'the header stands in for the missing equipment id',
  );
});

test('the tariff is published as a text state', () => {
  const gladys = createFakeGladys();
  const states = buildStates(gladys, parseTelegram(NL_DSMR5));
  const tariff = states.find((s) => s.device_feature_external_id.endsWith(':tariff'));
  assert.deepEqual(tariff, {
    device_feature_external_id: 'ext:test-integration:electricity-meter:K8EG004046395507:tariff',
    text: '2',
  });
});

test('no telegram yet, no device', () => {
  assert.deepEqual(buildDiscoveredDevices(createFakeGladys(), null), []);
});

test('the layout signature changes when a meter appears, not when values change', () => {
  const gladys = createFakeGladys();
  const base = layoutSignature(gladys, parseTelegram(NL_DSMR5));
  const otherValues = parseTelegram(NL_DSMR5.replace('01.193*kW', '02.000*kW'));
  assert.equal(layoutSignature(gladys, otherValues), base);
  const withWater = parseTelegram(
    NL_DSMR5.replace(
      '0-1:24.1.0(003)',
      '0-2:24.1.0(007)\r\n0-2:24.2.1(101209112500W)(00042.500*m3)\r\n0-1:24.1.0(003)',
    ),
  );
  assert.notEqual(layoutSignature(gladys, withWater), base);
});
