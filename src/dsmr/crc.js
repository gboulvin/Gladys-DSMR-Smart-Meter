// -----------------------------------------------------------------------------
// CRC of a DSMR telegram (DSMR 4.0 and later).
//
// CRC16/ARC (polynomial 0xA001 reflected, initial value 0), computed over every
// byte from the leading `/` up to and including the `!`, and written after the
// `!` as 4 uppercase hex digits. DSMR 2.2 and 3.0 telegrams carry no CRC.
// -----------------------------------------------------------------------------

/**
 * CRC16/ARC of a latin1 string.
 * @param {string} text - Telegram bytes, from `/` to `!` included.
 * @returns {number} The 16-bit CRC.
 */
export function crc16(text) {
  let crc = 0;
  for (let i = 0; i < text.length; i += 1) {
    crc ^= text.charCodeAt(i) & 0xff;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
  }
  return crc;
}

/**
 * Check the CRC written at the end of a telegram.
 * @param {string} telegram - Whole telegram, from `/` to the CRC line.
 * @returns {{ present: boolean, valid: boolean }} `present: false` for a DSMR
 *   2.2/3.0 telegram, which carries none (and is then considered valid).
 */
export function checkTelegramCrc(telegram) {
  const bang = telegram.lastIndexOf('!');
  if (bang === -1) {
    return { present: false, valid: false };
  }
  const written = telegram.slice(bang + 1).trim();
  if (written === '') {
    return { present: false, valid: true };
  }
  if (!/^[0-9A-Fa-f]{4}$/.test(written)) {
    return { present: true, valid: false };
  }
  const start = telegram.indexOf('/');
  const computed = crc16(telegram.slice(start, bang + 1));
  return { present: true, valid: computed === parseInt(written, 16) };
}
