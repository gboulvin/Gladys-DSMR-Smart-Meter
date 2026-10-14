import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { P1Hub } from '../src/hub.js';
import { DailyTracker } from '../src/daily.js';
import { READER_STATUS } from '../src/dsmr/reader.js';
import { normalizeConfig } from '../src/config.js';
import { NL_DSMR5, nlTelegram } from './fixtures/telegrams.js';

async function setup({ publishInterval = 10 } = {}) {
  let now = 1_000_000;
  const clock = () => now;
  const gladys = createFakeGladys();
  const dir = await mkdtemp(join(tmpdir(), 'dsmr-hub-'));
  const daily = new DailyTracker({ file: join(dir, 'daily.json'), now: clock });
  const hub = new P1Hub({ gladys, daily, now: clock });
  hub.setConfig(normalizeConfig({ host: 'p1.local', publish_interval: publishInterval }));
  let changes = 0;
  hub.onChange = () => {
    changes += 1;
  };
  return {
    gladys,
    hub,
    daily,
    advance: (ms) => {
      now += ms;
    },
    changes: () => changes,
  };
}

test('the first telegram publishes the devices, then their states', async () => {
  const { gladys, hub, changes } = await setup();
  await hub.handleTelegram(NL_DSMR5);
  assert.equal(gladys.fake.discoveredDevices.length, 2, 'electricity + gas');
  assert.equal(
    gladys.fake.lastState('ext:test-integration:electricity-meter:K8EG004046395507:import-power'),
    1193,
  );
  assert.equal(
    gladys.fake.lastState('ext:test-integration:gas-meter:2222ABCD123456789:index'),
    12785.123,
  );
  assert.equal(changes(), 1, 'the widgets are nudged when the layout appears');
});

test('the devices are only published again when the layout changes', async () => {
  const { gladys, hub } = await setup();
  await hub.handleTelegram(nlTelegram({ importPower: '01.000' }));
  await hub.handleTelegram(nlTelegram({ importPower: '02.000' }));
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, 1);
  hub.restart();
  await hub.handleTelegram(nlTelegram({ importPower: '02.000' }));
  assert.equal(gladys.fake.bodies('POST', '/discovered_device').length, 2);
});

test('states are throttled to the refresh interval, and only changes are sent', async () => {
  const { gladys, hub, advance } = await setup({ publishInterval: 10 });
  const powerId = 'ext:test-integration:electricity-meter:K8EG004046395507:import-power';
  await hub.handleTelegram(nlTelegram({ importPower: '01.000' }));
  const afterFirst = gladys.fake.states.length;
  advance(1000);
  await hub.handleTelegram(nlTelegram({ importPower: '02.000' }));
  assert.equal(gladys.fake.states.length, afterFirst, 'a telegram a second later is not sent');
  assert.equal(gladys.fake.lastState(powerId), 1000);
  advance(10_000);
  await hub.handleTelegram(nlTelegram({ importPower: '03.000' }));
  assert.equal(gladys.fake.lastState(powerId), 3000);
  // Only the power features changed (total + L1), the indexes did not.
  assert.equal(gladys.fake.states.length, afterFirst + 2);
});

test('a telegram with a bad CRC is dropped', async () => {
  const { gladys, hub } = await setup();
  await hub.handleTelegram(NL_DSMR5.replace('01.193*kW', '09.193*kW'));
  assert.equal(hub.crcErrors, 1);
  assert.equal(hub.reading, null);
  assert.equal(gladys.fake.states.length, 0);
});

test('scene events are published as they happen, whatever the refresh interval', async () => {
  const { gladys, hub, advance } = await setup({ publishInterval: 300 });
  await hub.handleTelegram(nlTelegram({ tariff: '0001' }));
  advance(1000);
  await hub.handleTelegram(nlTelegram({ tariff: '0002' }));
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [event.key, event.data.tariff]),
    [['tariff_changed', '2']],
  );
});

test('telegrams arriving during processing are coalesced to the latest', async () => {
  const { gladys, hub } = await setup();
  await Promise.all([
    hub.handleTelegram(nlTelegram({ importPower: '01.000' })),
    hub.handleTelegram(nlTelegram({ importPower: '02.000' })),
    hub.handleTelegram(nlTelegram({ importPower: '03.000' })),
  ]);
  assert.equal(hub.telegramCount, 2, 'the first, then only the latest');
  assert.equal(hub.reading.electricity.importPower, 3000);
  assert.ok(gladys.fake.discoveredDevices.length > 0);
});

test('the connection status is reported once per change, with the transport badge', async () => {
  const { gladys, hub } = await setup();
  await hub.handleTelegram(NL_DSMR5);
  await hub.setStatus(READER_STATUS.CONNECTED);
  await hub.setStatus(READER_STATUS.CONNECTED);
  const error = new Error('connect ECONNREFUSED');
  await hub.setStatus(READER_STATUS.ERROR, error);
  // The reader retries: connecting, then the same error again.
  await hub.setStatus(READER_STATUS.CONNECTING);
  await hub.setStatus(READER_STATUS.ERROR, error);
  assert.equal(hub.lastError, error, 'the error is kept for the test action');
  const statuses = gladys.fake.bodies('POST', '/connection_status');
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].connected, true);
  assert.equal(statuses[1].connected, false);
  assert.match(statuses[1].message.fr, /injoignable/);
  const transports = gladys.fake.bodies('POST', '/device/transport');
  assert.deepEqual(
    transports.at(-1).transports.map((entry) => entry.transport),
    ['unreachable', 'unreachable'],
  );
});

test('waitForTelegram resolves with the next reading, or rejects on timeout', async (t) => {
  const { hub } = await setup();
  const waiting = hub.waitForTelegram(1000);
  await hub.handleTelegram(NL_DSMR5);
  assert.equal((await waiting).equipmentId, 'K8EG004046395507');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timeout = hub.waitForTelegram(1000);
  t.mock.timers.tick(1000);
  await assert.rejects(timeout, /No telegram received/);
});
