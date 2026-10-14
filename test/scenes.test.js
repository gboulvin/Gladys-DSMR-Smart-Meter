import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { P1Hub } from '../src/hub.js';
import { DailyTracker } from '../src/daily.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { normalizeConfig } from '../src/config.js';
import { NL_DSMR5, SE_TOTALS } from './fixtures/telegrams.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const outputsOf = (key) =>
  manifest.scene_actions.find((entry) => entry.key === key).outputs.map((o) => [o.key, o.type]);

async function hubWith(telegram) {
  const dir = await mkdtemp(join(tmpdir(), 'dsmr-scenes-'));
  const hub = new P1Hub({
    gladys: createFakeGladys(),
    daily: new DailyTracker({ file: join(dir, 'daily.json') }),
  });
  hub.setConfig(normalizeConfig({ host: 'p1.local' }));
  if (telegram) await hub.handleTelegram(telegram);
  return hub;
}

function assertDeclaredOutputs(key, outputs) {
  const declared = new Map(outputsOf(key));
  for (const [name, value] of Object.entries(outputs)) {
    assert.ok(declared.has(name), `${key}: output ${name} is not declared, the core drops it`);
    assert.equal(typeof value, declared.get(name), `${key}: output ${name} type`);
  }
}

test('get_meter_readings returns the latest values with their declared types', async () => {
  const outputs = await SCENE_ACTIONS.get_meter_readings(await hubWith(NL_DSMR5));
  assert.deepEqual(outputs, {
    power_consumed: 1193,
    power_injected: 0,
    net_power: 1193,
    consumption_index: 246913.578,
    injection_index: 246913.578,
    tariff: '2',
    gas_index: 12785.123,
  });
  assertDeclaredOutputs('get_meter_readings', outputs);
});

test('get_meter_readings leaves out what the meter does not measure', async () => {
  const outputs = await SCENE_ACTIONS.get_meter_readings(await hubWith(SE_TOTALS));
  assert.equal(outputs.gas_index, undefined);
  assert.equal(outputs.tariff, undefined);
  assert.equal(outputs.consumption_index, 6678.394);
});

test('get_daily_summary returns the totals of the day', async () => {
  const outputs = await SCENE_ACTIONS.get_daily_summary(await hubWith(NL_DSMR5));
  assert.deepEqual(outputs, {
    consumption_today: 0,
    injection_today: 0,
    gas_today: 0,
    peak_power_today: 1193,
  });
  assertDeclaredOutputs('get_daily_summary', outputs);
});

test('without any telegram, the scene actions fail with a clear message', async () => {
  const hub = await hubWith(null);
  for (const action of Object.values(SCENE_ACTIONS)) {
    await assert.rejects(action(hub), /No telegram received/);
  }
});
