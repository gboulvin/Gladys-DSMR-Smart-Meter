// -----------------------------------------------------------------------------
// Entry point of the DSMR Smart Meter integration for Gladys Assistant.
//
// Reads the P1 port of a DSMR smart meter (electricity, plus the gas and water
// meters it relays) through a network P1 reader, and publishes the readings
// as Gladys devices. This file only wires the SDK to the modules of src/:
//   - src/dsmr/      the P1 protocol (connection, framing, decryption, parsing);
//   - src/hub.js     what happens to each telegram;
//   - src/devices/   the Gladys devices derived from a telegram;
//   - src/scenes.js, src/sceneEvents.js, src/widgets.js, src/actions.js.
//
// Environment variables provided by the Gladys supervisor to the container
// (read by the SDK): GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN,
// GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { configProblem, normalizeConfig } from './src/config.js';
import { startReader } from './src/dsmr/reader.js';
import { DailyTracker } from './src/daily.js';
import { P1Hub } from './src/hub.js';
import { buildDiscoveredDevices } from './src/devices/index.js';
import { ACTIONS } from './src/actions.js';
import { SCENE_ACTIONS } from './src/scenes.js';
import { WIDGETS, refreshWidgets } from './src/widgets.js';

const gladys = new GladysIntegration();
const daily = new DailyTracker();
const hub = new P1Hub({ gladys, daily });
hub.onChange = () => refreshWidgets(gladys);

let rawConfig = {};
let config = normalizeConfig();
let stopReader = null;

// --- Discovery: Gladys asks for the list of devices --------------------------
// The devices come from the telegrams: before the first one, there is nothing
// to offer yet (it arrives within seconds of the connection).
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, hub.reading));
});

// --- Manifest actions: buttons of the Configuration screen -------------------
for (const [key, handler] of Object.entries(ACTIONS)) {
  gladys.onAction(key, (fields) => handler(hub, { fields, config, rawConfig }));
}

// --- Scene actions (Gladys 5.1+) ---------------------------------------------
// Scene TRIGGERS need no handler: the hub fires them (see src/sceneEvents.js).
for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
  gladys.onSceneAction(key, (fields) => handler(hub, { fields, config }));
}

// --- Dashboard widgets (Gladys 5.1+) -----------------------------------------
for (const [key, widget] of Object.entries(WIDGETS)) {
  gladys.onWidgetGet(key, (request) => widget.get(gladys, hub, request));
}

// --- Configuration ------------------------------------------------------------
async function applyConfig(newRawConfig) {
  rawConfig = newRawConfig ?? {};
  config = normalizeConfig(rawConfig);
  hub.setConfig(config);
  stopReader?.();
  stopReader = null;

  hub.restart();
  const problem = configProblem(config, rawConfig.decryption_key);
  if (problem) {
    logger.warn(`Configuration incomplete: ${problem.en}`);
    await gladys.setConnectionStatus(false, problem);
    refreshWidgets(gladys);
    return;
  }
  stopReader = startReader(config, {
    onTelegram: (telegram) => hub.handleTelegram(telegram),
    onStatus: (status, error) => {
      hub.setStatus(status, error).catch((err) => logger.error('Status update failed', err));
    },
  });
}

gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> restarting the P1 connection');
  await applyConfig(newConfig);
});

// --- Connection lifecycle ----------------------------------------------------
// The config may have changed while the WebSocket was down: re-read it and
// restart the P1 connection with it at every (re)connection. Today's totals
// are only loaded from /data once: afterwards the memory is fresher.
let dailyLoaded = false;
gladys.on('connected', async () => {
  try {
    if (!dailyLoaded) {
      await daily.load();
      dailyLoaded = true;
    }
    await applyConfig(await gladys.getConfig());
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Initialisierung fehlgeschlagen, prüfen Sie die Logs der Integration.',
        es: 'La inicialización ha fallado, consulte los registros de la integración.',
      })
      .catch(() => {});
  }
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown(async (signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopReader?.();
  await daily.save();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the DSMR Smart Meter integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
