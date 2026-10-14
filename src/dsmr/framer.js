// -----------------------------------------------------------------------------
// Telegram framing: turn a byte stream (TCP socket, serial-over-IP bridge)
// into whole telegrams.
//
// A P1 reader forwards the meter bytes as they come: one telegram can arrive
// in several chunks, and the connection usually starts in the middle of one.
// The framer buffers the stream and hands out each telegram from its `/`
// header to the end of its `!CRC` line, dropping the partial one at the start.
//
// Luxembourg (Smarty) meters encrypt their telegrams (DLMS general-glo-
// ciphering, AES-128-GCM): the EncryptedFramer cuts those binary frames and
// decrypts them with the key the grid operator gives the customer.
// -----------------------------------------------------------------------------

import { decryptFrame, ENCRYPTED_FRAME_TAG } from './decrypt.js';

// A telegram is a few kB at most: anything bigger is garbage (wrong port,
// wrong baud rate on the bridge), dropped instead of growing forever.
export const MAX_BUFFER_LENGTH = 16 * 1024;

export class TelegramFramer {
  constructor() {
    this.buffer = '';
  }

  /**
   * Feed a chunk of the stream.
   * @param {Buffer | string} chunk - Bytes received.
   * @returns {string[]} The telegrams completed by this chunk, in order.
   */
  push(chunk) {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('latin1');
    const telegrams = [];
    for (;;) {
      const start = this.buffer.indexOf('/');
      if (start === -1) {
        this.buffer = '';
        break;
      }
      const bang = this.buffer.indexOf('!', start);
      if (bang === -1) {
        this.buffer = this.buffer.slice(start);
        break;
      }
      const end = this.buffer.indexOf('\n', bang);
      if (end === -1) {
        this.buffer = this.buffer.slice(start);
        break;
      }
      // A header after `start` means the telegram was cut: keep the last one.
      const realStart = this.buffer.lastIndexOf('/', bang);
      telegrams.push(this.buffer.slice(realStart, end + 1));
      this.buffer = this.buffer.slice(end + 1);
    }
    if (this.buffer.length > MAX_BUFFER_LENGTH) {
      this.buffer = '';
    }
    return telegrams;
  }
}

export class EncryptedFramer {
  /**
   * @param {string} keyHex - 32 hex characters (AES-128 key from the grid operator).
   */
  constructor(keyHex) {
    this.keyHex = keyHex;
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Feed a chunk of the stream.
   * @param {Buffer} chunk - Bytes received.
   * @returns {{ telegrams: string[], errors: Error[] }} Decrypted telegrams,
   *   and the frames that failed to decrypt (wrong key, corrupted bytes).
   */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const telegrams = [];
    const errors = [];
    for (;;) {
      const start = this.buffer.indexOf(ENCRYPTED_FRAME_TAG);
      if (start === -1) {
        this.buffer = Buffer.alloc(0);
        break;
      }
      this.buffer = this.buffer.subarray(start);
      // 0xDB, title length, title (8), 0x82, length (2): 13 header bytes.
      if (this.buffer.length < 13) {
        break;
      }
      const titleLength = this.buffer[1];
      const lengthOffset = 2 + titleLength + 1;
      if (titleLength !== 8 || this.buffer[2 + titleLength] !== 0x82) {
        // Not a frame header: skip this byte and look for the next tag.
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      const total = lengthOffset + 2 + this.buffer.readUInt16BE(lengthOffset);
      if (this.buffer.length < total) {
        break;
      }
      const frame = this.buffer.subarray(0, total);
      this.buffer = this.buffer.subarray(total);
      try {
        telegrams.push(decryptFrame(frame, this.keyHex));
      } catch (err) {
        errors.push(err);
      }
    }
    if (this.buffer.length > MAX_BUFFER_LENGTH) {
      this.buffer = Buffer.alloc(0);
    }
    return { telegrams, errors };
  }
}
