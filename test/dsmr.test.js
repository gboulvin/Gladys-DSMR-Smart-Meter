import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv } from 'node:crypto';
import { checkTelegramCrc, crc16 } from '../src/dsmr/crc.js';
import {
  decodeHexString,
  parseQuantity,
  parseTelegram,
  parseTimestamp,
} from '../src/dsmr/parser.js';
import { EncryptedFramer, TelegramFramer } from '../src/dsmr/framer.js';
import { decryptFrame, normalizeKey, SMARTY_AUTHENTICATION_KEY } from '../src/dsmr/decrypt.js';
import { BE_FLUVIUS, LU_SMARTY, NL_DSMR22, NL_DSMR5, SE_TOTALS } from './fixtures/telegrams.js';

const KEY = '000102030405060708090A0B0C0D0E0F';

/** Encrypt a telegram like a Smarty meter does (the inverse of decryptFrame). */
function encryptLikeSmarty(telegram, keyHex = KEY, frameCounter = 1) {
  const systemTitle = Buffer.from('534147670000AB12', 'hex');
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(frameCounter);
  const securityControl = Buffer.from([0x30]);
  const cipher = createCipheriv(
    'aes-128-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.concat([systemTitle, counter]),
    { authTagLength: 12 },
  );
  cipher.setAAD(Buffer.concat([securityControl, Buffer.from(SMARTY_AUTHENTICATION_KEY, 'hex')]));
  const ciphertext = Buffer.concat([cipher.update(telegram, 'latin1'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const length = Buffer.alloc(2);
  length.writeUInt16BE(1 + 4 + ciphertext.length + tag.length);
  return Buffer.concat([
    Buffer.from([0xdb, 0x08]),
    systemTitle,
    Buffer.from([0x82]),
    length,
    securityControl,
    counter,
    ciphertext,
    tag,
  ]);
}

// --- CRC ---------------------------------------------------------------------

test('crc16 is CRC-16/ARC (reference check value)', () => {
  assert.equal(crc16('123456789'), 0xbb3d);
});

test('a corrupted telegram fails its CRC, a DSMR 2.2 one has none', () => {
  assert.deepEqual(checkTelegramCrc(NL_DSMR5), { present: true, valid: true });
  const corrupted = NL_DSMR5.replace('1-0:1.7.0(01.193*kW)', '1-0:1.7.0(01.993*kW)');
  assert.deepEqual(checkTelegramCrc(corrupted), { present: true, valid: false });
  assert.deepEqual(checkTelegramCrc(NL_DSMR22), { present: false, valid: true });
});

// --- Parser ------------------------------------------------------------------

test('parses a Dutch DSMR 5 telegram', () => {
  const reading = parseTelegram(NL_DSMR5);
  assert.equal(reading.version, '50');
  assert.equal(reading.equipmentId, 'K8EG004046395507');
  assert.equal(reading.tariff, '2');
  assert.equal(reading.timestamp, '2010-12-09T10:30:20.000Z', 'W = winter time, UTC+1');
  assert.equal(reading.dayKey, '2010-12-09');
  assert.deepEqual(reading.electricity.importIndex, { t1: 123456.789, t2: 123456.789 });
  assert.equal(reading.electricity.importPower, 1193, 'kW are converted to W');
  assert.equal(reading.electricity.exportPower, 0);
  assert.equal(reading.electricity.powerFailures, 4);
  assert.equal(reading.electricity.longPowerFailures, 2);
  assert.deepEqual(reading.electricity.phases.l2, {
    importPower: 2222,
    exportPower: 5555,
    current: 2,
    voltage: 220.2,
    sags: 1,
    swells: 3,
  });
  assert.match(reading.electricity.message, /^0123456789/, 'the hex message is decoded');
  assert.deepEqual(reading.mbus, [
    {
      channel: 1,
      deviceType: 3,
      equipmentId: '2222ABCD123456789',
      value: 12785.123,
      dayKey: '2010-12-09',
      kind: 'gas',
    },
  ]);
});

test('parses a Belgian Fluvius telegram: capacity registers and gas on 24.2.3', () => {
  const reading = parseTelegram(BE_FLUVIUS);
  assert.equal(reading.version, '50217');
  assert.equal(reading.tariff, '1');
  assert.equal(reading.timestamp, '2020-05-12T11:54:09.000Z', 'S = summer time, UTC+2');
  assert.equal(reading.electricity.averageDemand, 2351);
  assert.equal(reading.electricity.monthPeakDemand, 2589, 'the value, not the timestamp');
  assert.deepEqual(Object.keys(reading.electricity.phases), ['l1']);
  assert.equal(reading.electricity.message, null, 'an empty message is no message');
  assert.equal(reading.mbus[0].kind, 'gas');
  assert.equal(reading.mbus[0].value, 112.384);
  assert.equal(reading.mbus[0].equipmentId, '7FLO2119033733');
});

test('parses a Swedish telegram: totals only, no equipment id', () => {
  const reading = parseTelegram(SE_TOTALS);
  assert.equal(reading.equipmentId, null);
  assert.equal(reading.header, 'ELL5\\253833635_A');
  assert.equal(reading.tariff, null);
  assert.deepEqual(reading.electricity.importIndex, { total: 6678.394 });
  assert.deepEqual(reading.electricity.exportIndex, { total: 0 });
  assert.equal(reading.electricity.phases.l3.current, 1.7);
  assert.deepEqual(reading.mbus, []);
});

test('parses a DSMR 2.2 telegram: gas value on the next line', () => {
  const reading = parseTelegram(NL_DSMR22);
  assert.equal(reading.timestamp, null);
  assert.equal(reading.dayKey, null);
  assert.equal(reading.electricity.importPower, 980);
  assert.equal(reading.mbus[0].value, 124.477);
  assert.equal(reading.mbus[0].kind, 'gas');
});

test('parses a decrypted Luxembourg Smarty telegram', () => {
  const reading = parseTelegram(LU_SMARTY);
  assert.equal(reading.equipmentId, 'SAG1030000000000', 'from 0-0:42.0.0');
  assert.deepEqual(reading.electricity.importIndex, { total: 441.879 });
  assert.equal(reading.electricity.importPower, 243);
});

test('a water meter on M-Bus is told apart from the gas meter', () => {
  const telegram = NL_DSMR5.replace(
    '0-1:24.2.1(101209112500W)(12785.123*m3)',
    '0-1:24.2.1(101209112500W)(12785.123*m3)\r\n0-2:24.1.0(007)\r\n0-2:24.2.1(101209112500W)(00042.500*m3)',
  );
  const reading = parseTelegram(telegram);
  assert.deepEqual(
    reading.mbus.map((entry) => [entry.channel, entry.kind, entry.value]),
    [
      [1, 'gas', 12785.123],
      [2, 'water', 42.5],
    ],
  );
});

test('value helpers', () => {
  assert.equal(parseQuantity('00.250*kW'), 250);
  assert.equal(parseQuantity('1500*Wh'), 1.5);
  assert.equal(parseQuantity('12.5*m3'), 12.5);
  assert.equal(parseQuantity('abc'), null);
  assert.equal(decodeHexString('4B384547'), 'K8EG');
  assert.equal(decodeHexString('not-hex'), 'not-hex');
  assert.deepEqual(parseTimestamp('261014235959S'), {
    iso: '2026-10-14T21:59:59.000Z',
    dayKey: '2026-10-14',
  });
  assert.deepEqual(parseTimestamp('garbage'), { iso: null, dayKey: null });
});

// --- Framing -----------------------------------------------------------------

test('the framer rebuilds telegrams split across chunks and drops the partial first one', () => {
  const framer = new TelegramFramer();
  const stream = NL_DSMR5.slice(200) + BE_FLUVIUS + NL_DSMR5;
  const telegrams = [];
  for (let i = 0; i < stream.length; i += 37) {
    telegrams.push(...framer.push(Buffer.from(stream.slice(i, i + 37), 'latin1')));
  }
  assert.deepEqual(telegrams, [BE_FLUVIUS, NL_DSMR5]);
});

test('the framer hands out several telegrams of one chunk, DSMR 2.2 included', () => {
  const framer = new TelegramFramer();
  assert.deepEqual(framer.push(NL_DSMR22 + SE_TOTALS), [NL_DSMR22, SE_TOTALS]);
});

test('a telegram cut by a new header is dropped, the new one kept', () => {
  const framer = new TelegramFramer();
  const cut = NL_DSMR5.slice(0, 300);
  assert.deepEqual(framer.push(cut + SE_TOTALS), [SE_TOTALS]);
});

test('the framer does not grow forever on garbage', () => {
  const framer = new TelegramFramer();
  framer.push(`/${'x'.repeat(20_000)}`);
  assert.equal(framer.buffer, '');
  assert.deepEqual(framer.push(SE_TOTALS), [SE_TOTALS]);
});

// --- Luxembourg encryption ---------------------------------------------------

test('decrypts a Smarty frame', () => {
  assert.equal(decryptFrame(encryptLikeSmarty(LU_SMARTY), KEY), LU_SMARTY);
});

test('a wrong key is reported, not a garbage telegram', () => {
  assert.throws(
    () => decryptFrame(encryptLikeSmarty(LU_SMARTY), 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'),
    /check the decryption key/,
  );
});

test('the encrypted framer cuts and decrypts a stream of frames', () => {
  const framer = new EncryptedFramer(KEY);
  const stream = Buffer.concat([
    Buffer.from([0x00, 0x12]), // noise before the first frame
    encryptLikeSmarty(LU_SMARTY, KEY, 1),
    encryptLikeSmarty(LU_SMARTY, KEY, 2),
  ]);
  const telegrams = [];
  for (let i = 0; i < stream.length; i += 50) {
    const result = framer.push(stream.subarray(i, i + 50));
    assert.deepEqual(result.errors, []);
    telegrams.push(...result.telegrams);
  }
  assert.deepEqual(telegrams, [LU_SMARTY, LU_SMARTY]);
});

test('normalizeKey accepts the usual spellings of a key and refuses the others', () => {
  assert.equal(normalizeKey('00 01 02 03 04 05 06 07 08 09 0a 0b 0c 0d 0e 0f'), KEY);
  assert.equal(normalizeKey('0x000102030405060708090a0b0c0d0e0f'), KEY);
  assert.equal(normalizeKey('1234'), '');
  assert.equal(normalizeKey(undefined), '');
});
