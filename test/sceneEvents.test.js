import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTelegram } from '../src/dsmr/parser.js';
import { DIRECTION_HOLD_MS, SCENE_TRIGGERS, SceneEventDetector } from '../src/sceneEvents.js';
import { BE_FLUVIUS, nlTelegram } from './fixtures/telegrams.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const DEVICE = 'ext:test-integration:electricity-meter:K8EG004046395507';

function detector() {
  let now = 0;
  const instance = new SceneEventDetector({ now: () => now });
  return {
    instance,
    feed: (values) => instance.update(parseTelegram(nlTelegram(values)), DEVICE),
    advance: (ms) => {
      now += ms;
    },
  };
}

test('the first reading only sets the baseline', () => {
  const { feed } = detector();
  assert.deepEqual(feed({ tariff: '0001', exportPower: '02.000', importPower: '00.000' }), []);
});

test('a tariff switch fires tariff_changed once', () => {
  const { feed } = detector();
  feed({ tariff: '0001' });
  assert.deepEqual(feed({ tariff: '0002' }), [
    { key: SCENE_TRIGGERS.TARIFF_CHANGED, data: { device: DEVICE, tariff: '2' } },
  ]);
  assert.deepEqual(feed({ tariff: '0002' }), [], 'no event while the tariff stays');
});

test('the grid direction must hold before grid_direction_changed fires', () => {
  const { feed, advance } = detector();
  feed({ importPower: '00.500', exportPower: '00.000' });
  // A short export (a cloud leaving the panels) fires nothing.
  assert.deepEqual(feed({ importPower: '00.000', exportPower: '01.200' }), []);
  advance(DIRECTION_HOLD_MS / 2);
  assert.deepEqual(feed({ importPower: '00.300', exportPower: '00.000' }), []);
  // A lasting export fires once.
  assert.deepEqual(feed({ importPower: '00.000', exportPower: '01.200' }), []);
  advance(DIRECTION_HOLD_MS);
  assert.deepEqual(feed({ importPower: '00.000', exportPower: '01.500' }), [
    {
      key: SCENE_TRIGGERS.GRID_DIRECTION_CHANGED,
      data: { device: DEVICE, direction: 'export', power: 1500 },
    },
  ]);
  advance(DIRECTION_HOLD_MS);
  assert.deepEqual(feed({ importPower: '00.000', exportPower: '01.500' }), []);
});

test('a new power failure fires power_failure_detected', () => {
  const { feed } = detector();
  feed({ failures: '00004', longFailures: '00002' });
  assert.deepEqual(feed({ failures: '00005', longFailures: '00002' }), [
    {
      key: SCENE_TRIGGERS.POWER_FAILURE_DETECTED,
      data: { device: DEVICE, failures: 5, long_failures: 2 },
    },
  ]);
});

test('a new monthly peak fires monthly_peak_increased, a new month does not', () => {
  const instance = new SceneEventDetector({ now: () => 0 });
  const peak = (kw) => parseTelegram(BE_FLUVIUS.replace('(02.589*kW)', `(${kw}*kW)`));
  instance.update(peak('02.589'), DEVICE);
  assert.deepEqual(instance.update(peak('03.100'), DEVICE), [
    { key: SCENE_TRIGGERS.MONTHLY_PEAK_INCREASED, data: { device: DEVICE, peak_power: 3100 } },
  ]);
  assert.deepEqual(instance.update(peak('00.400'), DEVICE), [], 'the register restarts');
});

test('event data only carries keys the trigger declares, filters with their options', () => {
  const { feed, advance } = detector();
  feed({ tariff: '0001', failures: '00001', importPower: '00.500' });
  feed({ tariff: '0002', failures: '00002', importPower: '00.000', exportPower: '01.000' });
  advance(DIRECTION_HOLD_MS);
  const events = feed({ tariff: '0001', importPower: '00.000', exportPower: '01.000' });
  assert.ok(events.length >= 2);
  for (const { key, data } of events) {
    const trigger = manifest.scene_triggers.find((entry) => entry.key === key);
    assert.ok(trigger, `trigger ${key} is declared`);
    const declared = [...(trigger.fields ?? []), ...(trigger.variables ?? [])].map((f) => f.key);
    for (const [dataKey, value] of Object.entries(data)) {
      assert.ok(declared.includes(dataKey), `${key}: data.${dataKey} would be dropped`);
      assert.ok(value === null || typeof value !== 'object', `${key}: data.${dataKey} is flat`);
    }
    for (const field of trigger.fields ?? []) {
      if (field.options) {
        assert.ok(
          field.options.some((option) => option.value === data[field.key]),
          `${key}: data.${field.key} "${data[field.key]}" matches a filter option`,
        );
      }
    }
  }
});
