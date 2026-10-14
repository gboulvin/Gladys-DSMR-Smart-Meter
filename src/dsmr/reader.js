// -----------------------------------------------------------------------------
// Connection to the P1 reader.
//
// The integration runs in a sandboxed container without access to the host
// serial ports, so it reads the P1 port through the network, in one of two
// ways:
//
//   - `tcp`: a raw TCP stream of the telegrams, what most P1 Wi-Fi/Ethernet
//     readers offer (SLIMMELEZER+, P1 Wi-Fi gateways, ESPHome/Tasmota P1
//     bridges...) and what `ser2net` serves for a USB P1 cable plugged into
//     any computer of the network, the Gladys host included;
//   - `http`: an HTTP endpoint answering the last raw telegram, polled at the
//     refresh interval (e.g. the HomeWizard Wi-Fi P1 meter: /api/v1/telegram).
//
// Both deliver telegrams to the same callback; the reader reconnects by itself
// with a capped backoff and reports its state through `onStatus`.
// -----------------------------------------------------------------------------

import net from 'node:net';
import { createLogger } from '@gladysassistant/integration-sdk';
import { EncryptedFramer, TelegramFramer } from './framer.js';

const logger = createLogger({ name: 'p1-reader' });

// No telegram for this long on an open socket: the reader is stuck (DSMR 2-4
// meters send every 10 s, DSMR 5 every second), reconnect.
export const SILENCE_TIMEOUT_MS = 60_000;
const RECONNECT_MIN_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
const HTTP_TIMEOUT_MS = 10_000;

export const READER_STATUS = {
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  ERROR: 'error',
  STOPPED: 'stopped',
};

/**
 * Start reading telegrams.
 * @param {object} config - Normalized config (connection_type, host, port,
 *   http_url, decryption_key, publish_interval).
 * @param {object} handlers
 * @param {(telegram: string) => void} handlers.onTelegram - A whole telegram.
 * @param {(status: string, error?: Error) => void} handlers.onStatus - State changes.
 * @param {object} [deps] - Injection points for the tests.
 * @returns {() => void} Stop function.
 */
export function startReader(config, { onTelegram, onStatus }, deps = {}) {
  if (config.connection_type === 'http') {
    return startHttpReader(config, { onTelegram, onStatus }, deps);
  }
  return startTcpReader(config, { onTelegram, onStatus }, deps);
}

function startTcpReader(config, { onTelegram, onStatus }, { connect = net.createConnection } = {}) {
  let stopped = false;
  let socket = null;
  let retryTimer = null;
  let delay = RECONNECT_MIN_MS;

  const scheduleReconnect = () => {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
  };

  const open = () => {
    if (stopped) return;
    onStatus(READER_STATUS.CONNECTING);
    logger.info(`Connecting to the P1 reader ${config.host}:${config.port}...`);
    const framer = config.decryption_key
      ? new EncryptedFramer(config.decryption_key)
      : new TelegramFramer();
    let receivedTelegram = false;
    socket = connect({ host: config.host, port: config.port });
    socket.setTimeout(SILENCE_TIMEOUT_MS);
    socket.on('data', (chunk) => {
      const result = framer.push(chunk);
      const telegrams = Array.isArray(result) ? result : result.telegrams;
      for (const err of result.errors ?? []) {
        onStatus(READER_STATUS.ERROR, err);
      }
      for (const telegram of telegrams) {
        if (!receivedTelegram) {
          receivedTelegram = true;
          delay = RECONNECT_MIN_MS;
          onStatus(READER_STATUS.CONNECTED);
        }
        onTelegram(telegram);
      }
    });
    socket.on('timeout', () => {
      logger.warn(`No telegram for ${SILENCE_TIMEOUT_MS / 1000} s, reconnecting`);
      socket.destroy(new Error('No telegram received from the P1 reader'));
    });
    socket.on('error', (err) => {
      logger.warn(`P1 reader connection error: ${err.message}`);
      onStatus(READER_STATUS.ERROR, err);
    });
    socket.on('close', () => {
      socket = null;
      if (!stopped) {
        scheduleReconnect();
      }
    });
  };

  open();
  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    socket?.destroy();
    onStatus(READER_STATUS.STOPPED);
  };
}

function startHttpReader(config, { onTelegram, onStatus }, { fetchImpl = globalThis.fetch } = {}) {
  let stopped = false;
  let timer = null;
  let failures = 0;

  const poll = async () => {
    if (stopped) return;
    try {
      const response = await fetchImpl(config.http_url, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from the P1 reader`);
      }
      const body = await response.text();
      // A whole telegram per answer: frame it to drop anything around it.
      const [telegram] = new TelegramFramer().push(body.endsWith('\n') ? body : `${body}\r\n`);
      if (!telegram) {
        throw new Error('The P1 reader answered no telegram');
      }
      failures = 0;
      onStatus(READER_STATUS.CONNECTED);
      onTelegram(telegram);
    } catch (err) {
      failures += 1;
      logger.warn(`P1 reader HTTP request failed: ${err.message}`);
      onStatus(READER_STATUS.ERROR, err);
    } finally {
      if (!stopped) {
        // Slow down while the reader is unreachable, like the TCP backoff.
        const base = config.publish_interval * 1000;
        const wait = failures === 0 ? base : Math.min(base * 2 ** failures, RECONNECT_MAX_MS);
        timer = setTimeout(poll, Math.max(wait, RECONNECT_MIN_MS));
      }
    }
  };

  onStatus(READER_STATUS.CONNECTING);
  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    onStatus(READER_STATUS.STOPPED);
  };
}
