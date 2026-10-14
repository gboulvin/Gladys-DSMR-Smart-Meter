// -----------------------------------------------------------------------------
// DSMR P1 telegram parser.
//
// A telegram is plain ASCII text pushed by the meter on its P1 port:
//
//   /ISk5\2MT382-1000                 <- header (manufacturer + model)
//                                     <- blank line
//   1-3:0.2.8(50)                     <- one COSEM object per line:
//   0-0:1.0.0(261014120000S)             OBIS code + one or more (values)
//   1-0:1.8.1(001234.567*kWh)
//   ...
//   !A1B2                             <- end, followed by the CRC (DSMR 4+)
//
// The parser is deliberately tolerant: it reads every object it knows, ignores
// the others, and works with the national variants built on DSMR — the
// Netherlands (DSMR 2.2 to 5.0.2), Belgium (eMUCs/Fluvius), Luxembourg (Smarty,
// once decrypted), Sweden and Hungary — which differ by the registers they
// fill (per-tariff indexes or totals only, average demand, monthly peak...).
// -----------------------------------------------------------------------------

import { checkTelegramCrc } from './crc.js';

// OBIS codes of the electricity meter. The `n` of the M-Bus codes (0-n:...) is
// the channel of a gas or water meter wired to the electricity meter.
export const OBIS = {
  VERSION: '1-3:0.2.8',
  VERSION_BE: '0-0:96.1.4',
  TIMESTAMP: '0-0:1.0.0',
  EQUIPMENT_ID: '0-0:96.1.1',
  EQUIPMENT_ID_ALT: '0-0:96.1.0',
  EQUIPMENT_ID_LU: '0-0:42.0.0',
  TARIFF: '0-0:96.14.0',
  IMPORT_TOTAL: '1-0:1.8.0',
  EXPORT_TOTAL: '1-0:2.8.0',
  IMPORT_POWER: '1-0:1.7.0',
  EXPORT_POWER: '1-0:2.7.0',
  AVERAGE_DEMAND: '1-0:1.4.0',
  MONTH_PEAK_DEMAND: '1-0:1.6.0',
  POWER_FAILURES: '0-0:96.7.21',
  LONG_POWER_FAILURES: '0-0:96.7.9',
  MESSAGE: '0-0:96.13.0',
};

// Per-tariff registers: 1-0:1.8.<t> (consumption) and 1-0:2.8.<t> (injection).
export const TARIFFS = ['1', '2', '3', '4'];

// Per-phase registers, keyed by the C group of their OBIS code.
export const PHASES = {
  l1: { importPower: '21', exportPower: '22', current: '31', voltage: '32' },
  l2: { importPower: '41', exportPower: '42', current: '51', voltage: '52' },
  l3: { importPower: '61', exportPower: '62', current: '71', voltage: '72' },
};

// M-Bus device types (EN 13757-3) of the meters wired to the electricity meter.
const MBUS_KINDS = { 3: 'gas', 7: 'water', 6: 'water' };

/**
 * Split a telegram into `{ header, objects }`: `objects` maps an OBIS code to
 * the list of its raw parenthesized values. A DSMR 2.2/3.0 gas reading puts
 * its value on the next line, which is appended to the object above it.
 * @param {string} telegram - Whole telegram text.
 */
export function splitTelegram(telegram) {
  const lines = telegram.split(/\r?\n/);
  const header = (lines.find((line) => line.startsWith('/')) ?? '').slice(1).trim();
  const objects = new Map();
  let last = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('(') && last) {
      last.push(...extractValues(line));
      continue;
    }
    const match = /^(\d+-\d+:\d+\.\d+\.\d+)(\(.*\))\s*$/.exec(line);
    if (!match) {
      continue;
    }
    last = extractValues(match[2]);
    objects.set(match[1], last);
  }
  return { header, objects };
}

function extractValues(text) {
  return [...text.matchAll(/\(([^)]*)\)/g)].map((m) => m[1]);
}

// Unit conversions to the units Gladys stores: a power in W, an energy in
// kWh, a volume in m³.
const UNIT_FACTORS = {
  kw: 1000,
  w: 1,
  kwh: 1,
  wh: 0.001,
  mwh: 1000,
  v: 1,
  a: 1,
  m3: 1,
  dm3: 0.001,
  l: 0.001,
};

/**
 * Parse a `value*unit` string into a number in the unit Gladys stores.
 * @param {string | undefined} raw - e.g. `001234.567*kWh`, `00.250*kW` (250 W).
 * @returns {number | null}
 */
export function parseQuantity(raw) {
  if (raw === undefined) {
    return null;
  }
  const [numberPart, unitPart] = raw.split('*');
  if (!/^[-+]?\d+(\.\d+)?$/.test(numberPart.trim())) {
    return null;
  }
  const value = Number(numberPart);
  const unit = (unitPart ?? '').trim().toLowerCase();
  if (unit === '') {
    return value;
  }
  return value * (UNIT_FACTORS[unit] ?? 1);
}

/**
 * Last numeric value of an object: `1-0:1.6.0(timestamp)(value*kW)` keeps
 * the value, not the timestamp.
 */
function lastQuantity(values) {
  if (!values || values.length === 0) {
    return null;
  }
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i].includes('*') || /^[-+]?\d+(\.\d+)?$/.test(values[i])) {
      return parseQuantity(values[i]);
    }
  }
  return null;
}

/**
 * Decode an hex-encoded ASCII string (equipment ids, text messages since
 * DSMR 4). Values that are not printable once decoded are returned as is.
 */
export function decodeHexString(raw) {
  if (!raw || !/^([0-9A-Fa-f]{2})+$/.test(raw)) {
    return raw ?? '';
  }
  const decoded = Buffer.from(raw, 'hex').toString('latin1');
  return /^[\x20-\x7e]*$/.test(decoded) ? decoded.trim() : raw;
}

/**
 * Parse a DSMR timestamp `YYMMDDhhmmssX` (X: S = summer time, W = winter
 * time, absent before DSMR 4) into an ISO date. Every country using DSMR is
 * on Central European Time: S is UTC+2, W is UTC+1.
 * @returns {{ iso: string | null, dayKey: string | null }}
 */
export function parseTimestamp(raw) {
  const match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})([SW]?)$/.exec(raw ?? '');
  if (!match) {
    return { iso: null, dayKey: null };
  }
  const [, yy, mo, dd, hh, mi, ss, dst] = match;
  const dayKey = `20${yy}-${mo}-${dd}`;
  if (!dst) {
    return { iso: null, dayKey };
  }
  const offset = dst === 'S' ? '+02:00' : '+01:00';
  const date = new Date(`20${yy}-${mo}-${dd}T${hh}:${mi}:${ss}${offset}`);
  return { iso: Number.isNaN(date.getTime()) ? null : date.toISOString(), dayKey };
}

function roundTo(value, decimals) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const watts = (values) => roundTo(lastQuantity(values), 0);
const kwh = (values) => roundTo(lastQuantity(values), 3);

/**
 * Read the M-Bus channels (gas and water meters wired to the electricity
 * meter) of a split telegram.
 */
function readMbus(objects) {
  const channels = new Map();
  const channelOf = (n) => {
    if (!channels.has(n)) {
      channels.set(n, {
        channel: n,
        deviceType: null,
        equipmentId: null,
        value: null,
        dayKey: null,
      });
    }
    return channels.get(n);
  };
  for (const [code, values] of objects) {
    const match = /^0-(\d):(24\.1\.0|96\.1\.[01]|24\.2\.1|24\.2\.3|24\.3\.0)$/.exec(code);
    if (!match || match[1] === '0') {
      continue;
    }
    const entry = channelOf(Number(match[1]));
    switch (match[2]) {
      case '24.1.0':
        entry.deviceType = Number(values[0]);
        break;
      case '96.1.0':
      case '96.1.1': // Belgium
        entry.equipmentId = decodeHexString(values[0]);
        break;
      case '24.2.1':
      case '24.2.3': {
        // (capture time)(value*m3). Belgium (Fluvius) uses 24.2.3.
        entry.value = roundTo(lastQuantity(values.slice(1)), 3);
        entry.dayKey = parseTimestamp(values[0]).dayKey;
        break;
      }
      case '24.3.0':
        // DSMR 2.2/3.0: (time)(..)(..)(..)(0-n:24.2.1)(m3) then (value) on the
        // next line, appended last by splitTelegram.
        entry.value = roundTo(parseQuantity(values.at(-1)), 3);
        entry.dayKey = parseTimestamp(values[0]).dayKey;
        break;
      default:
        break;
    }
  }
  return [...channels.values()]
    .filter((entry) => entry.value !== null)
    .map((entry) => ({
      ...entry,
      // A meter without its device type line is almost always the gas meter.
      kind: MBUS_KINDS[entry.deviceType] ?? (entry.deviceType === null ? 'gas' : 'other'),
    }))
    .filter((entry) => entry.kind !== 'other');
}

/**
 * Parse a whole telegram into a normalized reading.
 * @param {string} telegram - Telegram text, from `/` to the CRC line.
 * @returns {object} The reading; `crc.valid === false` means a corrupted
 *   telegram that must be dropped.
 */
export function parseTelegram(telegram) {
  const crc = checkTelegramCrc(telegram);
  const { header, objects } = splitTelegram(telegram);
  const get = (code) => objects.get(code);
  const first = (code) => get(code)?.[0];

  const importIndex = {};
  const exportIndex = {};
  for (const tariff of TARIFFS) {
    const imported = kwh(get(`1-0:1.8.${tariff}`));
    const exported = kwh(get(`1-0:2.8.${tariff}`));
    if (imported !== null) importIndex[`t${tariff}`] = imported;
    if (exported !== null) exportIndex[`t${tariff}`] = exported;
  }
  const importTotal = kwh(get(OBIS.IMPORT_TOTAL));
  const exportTotal = kwh(get(OBIS.EXPORT_TOTAL));
  if (importTotal !== null) importIndex.total = importTotal;
  if (exportTotal !== null) exportIndex.total = exportTotal;

  const phases = {};
  for (const [phase, groups] of Object.entries(PHASES)) {
    const values = {
      importPower: watts(get(`1-0:${groups.importPower}.7.0`)),
      exportPower: watts(get(`1-0:${groups.exportPower}.7.0`)),
      current: roundTo(lastQuantity(get(`1-0:${groups.current}.7.0`)), 2),
      voltage: roundTo(lastQuantity(get(`1-0:${groups.voltage}.7.0`)), 1),
      sags: roundTo(lastQuantity(get(`1-0:${groups.voltage}.32.0`)), 0),
      swells: roundTo(lastQuantity(get(`1-0:${groups.voltage}.36.0`)), 0),
    };
    if (Object.values(values).some((v) => v !== null)) {
      phases[phase] = values;
    }
  }

  const tariffRaw = first(OBIS.TARIFF);
  const tariff = tariffRaw && /^\d+$/.test(tariffRaw) ? String(Number(tariffRaw)) : null;
  const { iso, dayKey } = parseTimestamp(first(OBIS.TIMESTAMP));
  const equipmentId =
    decodeHexString(first(OBIS.EQUIPMENT_ID)) ||
    decodeHexString(first(OBIS.EQUIPMENT_ID_ALT)) ||
    decodeHexString(first(OBIS.EQUIPMENT_ID_LU)) ||
    null;

  return {
    header,
    version: first(OBIS.VERSION) ?? first(OBIS.VERSION_BE) ?? null,
    equipmentId,
    timestamp: iso,
    dayKey,
    tariff,
    crc,
    objectCount: objects.size,
    electricity: {
      importIndex,
      exportIndex,
      importPower: watts(get(OBIS.IMPORT_POWER)),
      exportPower: watts(get(OBIS.EXPORT_POWER)),
      averageDemand: watts(get(OBIS.AVERAGE_DEMAND)),
      monthPeakDemand: watts(get(OBIS.MONTH_PEAK_DEMAND)),
      powerFailures: roundTo(lastQuantity(get(OBIS.POWER_FAILURES)), 0),
      longPowerFailures: roundTo(lastQuantity(get(OBIS.LONG_POWER_FAILURES)), 0),
      message: decodeHexString(first(OBIS.MESSAGE)) || null,
      phases,
    },
    mbus: readMbus(objects),
  };
}
