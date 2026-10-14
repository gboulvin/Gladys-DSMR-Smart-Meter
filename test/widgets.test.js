import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { P1Hub } from '../src/hub.js';
import { DailyTracker } from '../src/daily.js';
import { READER_STATUS } from '../src/dsmr/reader.js';
import { buildDiscoveredDevices } from '../src/devices/index.js';
import { WIDGETS, WIDGET_KEYS, refreshWidgets } from '../src/widgets.js';
import { normalizeConfig } from '../src/config.js';
import { BE_FLUVIUS, LU_SMARTY, NL_DSMR22, NL_DSMR5, SE_TOTALS } from './fixtures/telegrams.js';

const VARIANTS = { NL_DSMR5, BE_FLUVIUS, SE_TOTALS, NL_DSMR22, LU_SMARTY };

async function hubWith(telegram) {
  const gladys = createFakeGladys();
  const dir = await mkdtemp(join(tmpdir(), 'dsmr-widgets-'));
  const hub = new P1Hub({ gladys, daily: new DailyTracker({ file: join(dir, 'daily.json') }) });
  hub.setConfig(normalizeConfig({ host: 'p1.local' }));
  if (telegram) {
    await hub.handleTelegram(telegram);
    await hub.setStatus(READER_STATUS.CONNECTED);
  }
  return { gladys, hub };
}

const request = (settings = {}, language = 'en') => ({ settings, language, units: 'metric' });

for (const [name, telegram] of Object.entries(VARIANTS)) {
  for (const key of Object.values(WIDGET_KEYS)) {
    test(`${name}: the ${key} content is rendered exactly as sent, in every language`, async () => {
      const { gladys, hub } = await hubWith(telegram);
      for (const language of ['en', 'fr', 'de', 'es']) {
        const content = await WIDGETS[key].get(gladys, hub, request({}, language));
        // [] = nothing the core would drop, truncate or trim to the budget.
        assert.deepEqual(validateWidgetContent(content), []);
      }
    });

    test(`${name}: the ${key} live bindings reference published features`, async () => {
      const { gladys, hub } = await hubWith(telegram);
      const featureIds = new Set(
        buildDiscoveredDevices(gladys, hub.reading).flatMap((d) =>
          d.features.map((f) => f.external_id),
        ),
      );
      const content = await WIDGETS[key].get(gladys, hub, request());
      const bindings = content.components.flatMap((c) => [
        ...(c.device_feature ? [c.device_feature] : []),
        ...(c.device_features ?? []),
      ]);
      for (const binding of bindings) {
        assert.ok(featureIds.has(binding), `unknown feature ${binding}`);
      }
    });
  }
}

test('before the first telegram, the widgets explain what they wait for', async () => {
  const { gladys, hub } = await hubWith(null);
  for (const widget of Object.values(WIDGETS)) {
    const content = await widget.get(gladys, hub, request());
    assert.deepEqual(validateWidgetContent(content), []);
    assert.equal(content.components[0].type, 'text');
  }
});

test('the overview follows the chart period of its settings', async () => {
  const { gladys, hub } = await hubWith(NL_DSMR5);
  const chartOf = async (settings) =>
    (await WIDGETS.p1_overview.get(gladys, hub, request(settings))).components.find(
      (c) => c.type === 'chart',
    );
  assert.equal((await chartOf({ chart_interval: 'last-week' })).interval, 'last-week');
  assert.equal((await chartOf({ chart_interval: 'bogus' })).interval, 'last-day');
});

test('the phases widget scales the current gauges to the fuse rating', async () => {
  const { gladys, hub } = await hubWith(NL_DSMR5);
  const content = await WIDGETS.p1_phases.get(gladys, hub, request({ fuse_rating: 40 }));
  const gauges = content.components.filter((c) => c.type === 'gauge');
  assert.equal(gauges.length, 3);
  assert.ok(gauges.every((gauge) => gauge.max === 40));
});

test('an unreachable reader shows in red', async () => {
  const { gladys, hub } = await hubWith(NL_DSMR5);
  await hub.setStatus(READER_STATUS.ERROR, new Error('ECONNREFUSED'));
  const content = await WIDGETS.p1_overview.get(gladys, hub, request());
  const rows = content.components.find((c) => c.type === 'status').items;
  assert.equal(rows.at(-1).color, 'danger');
});

test('refreshWidgets nudges every widget', () => {
  const gladys = createFakeGladys();
  refreshWidgets(gladys);
  assert.deepEqual(gladys.fake.widgetRefreshes, Object.keys(WIDGETS));
});
