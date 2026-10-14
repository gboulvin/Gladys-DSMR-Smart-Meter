import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS } from '../src/actions.js';
import { P1Hub } from '../src/hub.js';
import { DailyTracker } from '../src/daily.js';
import { normalizeConfig } from '../src/config.js';
import { NL_DSMR5 } from './fixtures/telegrams.js';

async function newHub() {
  const dir = await mkdtemp(join(tmpdir(), 'dsmr-actions-'));
  return new P1Hub({
    gladys: createFakeGladys(),
    daily: new DailyTracker({ file: join(dir, 'daily.json') }),
  });
}

test('test_connection describes the meter of the next telegram, in four languages', async () => {
  const hub = await newHub();
  const config = normalizeConfig({ host: 'p1.local' });
  const pending = ACTIONS.test_connection(hub, { config, rawConfig: { host: 'p1.local' } });
  await hub.handleTelegram(NL_DSMR5);
  const message = await pending;
  assert.match(message.en, /K8EG004046395507 \(DSMR 50, 3 phase\(s\)\)/);
  assert.match(message.fr, /gaz 12785.123 m³/);
  assert.ok(message.de && message.es);
  for (const text of Object.values(message)) {
    assert.ok(text.length <= 200, 'shown under the button: keep it short');
  }
});

test('test_connection reports an incomplete configuration without waiting', async () => {
  const hub = await newHub();
  const message = await ACTIONS.test_connection(hub, {
    config: normalizeConfig({}),
    rawConfig: {},
  });
  assert.match(message.en, /IP address/);
});

test('test_connection reports the reader error when no telegram comes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const hub = await newHub();
  hub.lastError = new Error('connect EHOSTUNREACH');
  const pending = ACTIONS.test_connection(hub, {
    config: normalizeConfig({ host: 'p1.local' }),
    rawConfig: { host: 'p1.local' },
  });
  t.mock.timers.tick(25_000);
  const message = await pending;
  assert.match(message.en, /unreachable \(connect EHOSTUNREACH\)/);
});
