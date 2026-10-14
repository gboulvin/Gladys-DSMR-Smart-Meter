import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DailyTracker } from '../src/daily.js';
import { parseTelegram } from '../src/dsmr/parser.js';
import { nlTelegram } from './fixtures/telegrams.js';

const tempFile = async () => join(await mkdtemp(join(tmpdir(), 'dsmr-daily-')), 'daily.json');
const reading = (values) => parseTelegram(nlTelegram(values));

test("today's totals are the index differences since the first telegram of the day", async () => {
  const tracker = new DailyTracker({ file: await tempFile() });
  await tracker.update(reading({ timestamp: '261014080000S', importPower: '00.500' }));
  await tracker.update(
    reading({
      timestamp: '261014180000S',
      importT1: '001001.500',
      importT2: '002002.250',
      exportT2: '000203.000',
      gas: '01002.125',
      importPower: '03.200',
    }),
  );
  await tracker.update(
    reading({
      timestamp: '261014181000S',
      importT1: '001001.500',
      importT2: '002002.250',
      exportT2: '000203.000',
      gas: '01002.125',
      importPower: '00.400',
    }),
  );
  assert.deepEqual(tracker.summary(), {
    day: '2026-10-14',
    consumption: 3.75,
    injection: 3,
    gas: 2.125,
    water: null,
    peakPower: 3200,
  });
});

test('a new day starts from zero and is saved at once', async () => {
  const file = await tempFile();
  const tracker = new DailyTracker({ file });
  await tracker.update(reading({ timestamp: '261014230000S' }));
  await tracker.update(reading({ timestamp: '261014235959S', importT1: '001005.000' }));
  assert.equal(tracker.summary().consumption, 5);
  const newDay = await tracker.update(
    reading({ timestamp: '261015000010S', importT1: '001005.100' }),
  );
  assert.equal(newDay, true);
  assert.equal(tracker.summary().consumption, 0);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).day, '2026-10-15');
});

test('a restart during the day keeps the start of the day', async () => {
  const file = await tempFile();
  const before = new DailyTracker({ file });
  await before.update(reading({ timestamp: '261014080000S' }));
  await before.save();

  const after = new DailyTracker({ file });
  await after.load();
  await after.update(reading({ timestamp: '261014120000S', importT2: '002004.000' }));
  assert.equal(after.summary().consumption, 4);
});

test('a corrupted state file starts a fresh day', async () => {
  const file = await tempFile();
  await writeFile(file, '{not json');
  const tracker = new DailyTracker({ file });
  await tracker.load();
  await tracker.update(reading({}));
  assert.equal(tracker.summary().consumption, 0);
});

test('an unwritable /data is not fatal', async () => {
  // A regular file where the directory should be: every write fails.
  const blocker = await tempFile();
  await writeFile(blocker, '');
  const tracker = new DailyTracker({ file: join(blocker, 'daily.json') });
  await tracker.update(reading({}));
  assert.equal(tracker.summary().consumption, 0);
});
