// -----------------------------------------------------------------------------
// Decryption of the encrypted P1 telegrams of the Luxembourg Smarty meters.
//
// Frame layout (DLMS general-glo-ciphering, AES-128-GCM):
//
//   DB | 08 | system title (8) | 82 | length (2, big-endian) |
//   security control (1, 0x30) | frame counter (4) | ciphertext | GCM tag (12)
//
// IV = system title + frame counter. The additional authenticated data is the
// security control byte followed by the authentication key, a fixed value on
// the Smarty meters. The decryption key (GUEK) is personal: the customer asks
// the grid operator (Creos) for it.
// -----------------------------------------------------------------------------

import { createDecipheriv } from 'node:crypto';

export const ENCRYPTED_FRAME_TAG = 0xdb;

// Authentication key used by every Smarty meter.
export const SMARTY_AUTHENTICATION_KEY = '00112233445566778899AABBCCDDEEFF';

const GCM_TAG_LENGTH = 12;

/**
 * Normalize a key typed by the user: spaces, dashes and `0x` are tolerated.
 * @param {string} key - Key as typed.
 * @returns {string} 32 uppercase hex characters, or '' when invalid.
 */
export function normalizeKey(key) {
  const hex = String(key ?? '')
    .replace(/0x/gi, '')
    .replace(/[\s:-]/g, '')
    .toUpperCase();
  return /^[0-9A-F]{32}$/.test(hex) ? hex : '';
}

/**
 * Decrypt one Smarty frame.
 * @param {Buffer} frame - The whole frame, from the 0xDB tag to the GCM tag.
 * @param {string} keyHex - Decryption key, 32 hex characters.
 * @param {string} [authKeyHex] - Authentication key.
 * @returns {string} The plaintext telegram.
 */
export function decryptFrame(frame, keyHex, authKeyHex = SMARTY_AUTHENTICATION_KEY) {
  if (frame[0] !== ENCRYPTED_FRAME_TAG) {
    throw new Error('Not an encrypted P1 frame');
  }
  const titleLength = frame[1];
  const systemTitle = frame.subarray(2, 2 + titleLength);
  let offset = 2 + titleLength + 1; // skip the 0x82 length marker
  const length = frame.readUInt16BE(offset);
  offset += 2;
  if (frame.length < offset + length || length < 1 + 4 + GCM_TAG_LENGTH) {
    throw new Error('Truncated encrypted P1 frame');
  }
  const securityControl = frame.subarray(offset, offset + 1);
  const frameCounter = frame.subarray(offset + 1, offset + 5);
  const end = offset + length;
  const ciphertext = frame.subarray(offset + 5, end - GCM_TAG_LENGTH);
  const tag = frame.subarray(end - GCM_TAG_LENGTH, end);

  const decipher = createDecipheriv(
    'aes-128-gcm',
    Buffer.from(keyHex, 'hex'),
    Buffer.concat([systemTitle, frameCounter]),
    { authTagLength: GCM_TAG_LENGTH },
  );
  decipher.setAAD(Buffer.concat([securityControl, Buffer.from(authKeyHex, 'hex')]));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('latin1');
  } catch {
    throw new Error('Decryption failed: check the decryption key');
  }
}
