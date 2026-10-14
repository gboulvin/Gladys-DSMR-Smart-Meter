// -----------------------------------------------------------------------------
// The P1 hub: what happens to every telegram.
//
//   telegram -> parse -> CRC check -> discovery (when the layout changes)
//            -> scene events (every telegram, they are transitions)
//            -> today's totals
//            -> states (throttled to the refresh interval of the config)
//
// A DSMR 5 meter sends a telegram every second, Gladys accepts 300 states a
// minute: states go through `publishChangedStates` (unchanged values are not
// sent again, except a heartbeat every 30 minutes) at most once per refresh
// interval. Telegrams are processed one at a time; while one is processed,
// only the most recent of the ones arriving is kept.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { parseTelegram } from './dsmr/parser.js';
import { READER_STATUS } from './dsmr/reader.js';
import {
  buildDiscoveredDevices,
  buildStates,
  electricityDeviceId,
  layoutSignature,
} from './devices/index.js';
import { SceneEventDetector } from './sceneEvents.js';

const logger = createLogger({ name: 'hub' });

export const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

export class P1Hub {
  /**
   * @param {object} options
   * @param {object} options.gladys - SDK instance.
   * @param {import('./daily.js').DailyTracker} options.daily - Today's totals.
   * @param {() => number} [options.now] - Clock (tests).
   */
  constructor({ gladys, daily, now = () => Date.now() }) {
    this.gladys = gladys;
    this.daily = daily;
    this.now = now;
    this.events = new SceneEventDetector({ now });
    this.config = null;
    this.reading = null;
    this.lastTelegramAt = null;
    this.lastPublishAt = null;
    this.layout = null;
    this.status = READER_STATUS.STOPPED;
    this.lastError = null;
    this.reported = null;
    this.telegramCount = 0;
    this.crcErrors = 0;
    this.processing = false;
    this.pending = null;
    this.waiters = [];
    this.onChange = () => {};
  }

  setConfig(config) {
    this.config = config;
  }

  /**
   * New connection (the config changed): the next telegram re-publishes the
   * devices, and the next reader state is reported even if unchanged, since
   * the config screen may show another message meanwhile.
   */
  restart() {
    this.layout = null;
    this.reported = null;
  }

  /**
   * Entry point of the reader. Never throws: a bad telegram is logged and
   * dropped, the next one comes a few seconds later.
   */
  async handleTelegram(text) {
    if (this.processing) {
      this.pending = text;
      return;
    }
    this.processing = true;
    try {
      let next = text;
      while (next !== null) {
        this.pending = null;
        try {
          await this.process(next);
        } catch (err) {
          logger.error('Telegram processing failed', err);
        }
        next = this.pending;
      }
    } finally {
      this.processing = false;
    }
  }

  async process(text) {
    const reading = parseTelegram(text);
    if (!reading.crc.valid) {
      this.crcErrors += 1;
      logger.warn(`Telegram dropped: invalid CRC (${this.crcErrors} so far)`);
      return;
    }
    if (reading.objectCount === 0) {
      logger.warn('Telegram dropped: no COSEM object found');
      return;
    }
    this.reading = reading;
    this.lastTelegramAt = this.now();
    this.telegramCount += 1;
    this.resolveWaiters(reading);

    const signature = layoutSignature(this.gladys, reading);
    if (signature !== this.layout) {
      logger.info('Meter layout changed -> publishing the discovered devices');
      await this.gladys.publishDiscoveredDevices(buildDiscoveredDevices(this.gladys, reading));
      this.layout = signature;
      this.onChange();
    }

    const device = electricityDeviceId(this.gladys, reading);
    for (const event of this.events.update(reading, device)) {
      logger.info(`Scene event ${event.key}`, event.data);
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => logger.warn(`publishSceneEvent ${event.key} failed: ${err.message}`));
    }

    const newDay = await this.daily.update(reading);
    if (newDay) this.onChange();

    const interval = (this.config?.publish_interval ?? 10) * 1000;
    if (this.lastPublishAt === null || this.now() - this.lastPublishAt >= interval) {
      this.lastPublishAt = this.now();
      await this.gladys.publishChangedStates(buildStates(this.gladys, reading), {
        heartbeat: STATE_HEARTBEAT_MS,
      });
    }
  }

  /**
   * Reader state change. Reports the connection status shown in the
   * Configuration screen and the transport badge of the devices, only when
   * what Gladys shows actually changes: a reader retrying every minute goes
   * through `connecting` each time, and must not re-report the same error.
   */
  async setStatus(status, error) {
    this.status = status;
    if (status === READER_STATUS.CONNECTED) {
      this.lastError = null;
    } else if (status === READER_STATUS.ERROR) {
      // Kept through the next `connecting`: the test action explains it.
      this.lastError = error ?? null;
    }
    if (status === READER_STATUS.CONNECTING || status === READER_STATUS.STOPPED) {
      return;
    }
    const connected = status === READER_STATUS.CONNECTED;
    const reported = connected ? 'connected' : `error:${error?.message}`;
    if (reported === this.reported) {
      return;
    }
    this.reported = reported;
    try {
      if (connected) {
        await this.gladys.setConnectionStatus(true);
      } else {
        await this.gladys.setConnectionStatus(false, readerErrorMessage(error));
      }
      await this.publishTransports(connected);
    } catch (err) {
      logger.warn(`Could not report the connection status: ${err.message}`);
    }
    this.onChange();
  }

  /** The devices are reached on the local network, or not at all right now. */
  async publishTransports(connected) {
    const devices = buildDiscoveredDevices(this.gladys, this.reading);
    if (devices.length === 0) return;
    await this.gladys.publishTransports(
      devices.map((device) => ({
        external_id: device.external_id,
        transport: connected ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
      })),
    );
  }

  /**
   * Resolve with the next valid telegram, or reject after `timeoutMs`.
   * @returns {Promise<object>} The reading.
   */
  waitForTelegram(timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve };
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(this.lastError ?? new Error('No telegram received'));
      }, timeoutMs);
      waiter.resolve = (reading) => {
        clearTimeout(timer);
        resolve(reading);
      };
      this.waiters.push(waiter);
    });
  }

  resolveWaiters(reading) {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.resolve(reading);
  }
}

/** Multi-language message of a reader error, shown in the Configuration screen. */
export function readerErrorMessage(error) {
  const detail = error?.message ? ` (${error.message.slice(0, 100)})` : '';
  if (/decrypt/i.test(error?.message ?? '')) {
    return {
      en: 'Telegrams cannot be decrypted: check the decryption key.',
      fr: 'Impossible de déchiffrer les télégrammes : vérifiez la clé de déchiffrement.',
      de: 'Telegramme können nicht entschlüsselt werden: Entschlüsselungsschlüssel prüfen.',
      es: 'No se pueden descifrar los telegramas: compruebe la clave de descifrado.',
    };
  }
  return {
    en: `P1 reader unreachable${detail}.`,
    fr: `Lecteur P1 injoignable${detail}.`,
    de: `P1-Leser nicht erreichbar${detail}.`,
    es: `Lector P1 inaccesible${detail}.`,
  };
}
