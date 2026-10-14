// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen.
//
// `test_connection` waits for the next telegram of the running connection
// (instead of opening a second one: most P1 readers accept a single client)
// and describes what was read, in the user's language.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { configProblem } from './config.js';
import { readerErrorMessage } from './hub.js';
import { mbusIndex, totalImport } from './summary.js';

const logger = createLogger({ name: 'actions' });

// Under the 30 s ack timeout of the action (manifest `timeout_seconds`).
export const TEST_TIMEOUT_MS = 25_000;

function describe(reading) {
  const meter = reading.equipmentId ?? reading.header ?? '?';
  const version = reading.version ?? '?';
  const index = totalImport(reading);
  const gas = mbusIndex(reading, 'gas');
  const phases = Object.keys(reading.electricity.phases).length || 1;
  const gasText = {
    en: gas === null ? 'no gas meter' : `gas ${gas} m³`,
    fr: gas === null ? 'pas de compteur gaz' : `gaz ${gas} m³`,
    de: gas === null ? 'kein Gaszähler' : `Gas ${gas} m³`,
    es: gas === null ? 'sin contador de gas' : `gas ${gas} m³`,
  };
  return {
    en: `Meter ${meter} (DSMR ${version}, ${phases} phase(s)): ${index ?? '?'} kWh consumed, ${gasText.en}.`,
    fr: `Compteur ${meter} (DSMR ${version}, ${phases} phase(s)) : ${index ?? '?'} kWh consommés, ${gasText.fr}.`,
    de: `Zähler ${meter} (DSMR ${version}, ${phases} Phase(n)): ${index ?? '?'} kWh bezogen, ${gasText.de}.`,
    es: `Contador ${meter} (DSMR ${version}, ${phases} fase(s)): ${index ?? '?'} kWh consumidos, ${gasText.es}.`,
  };
}

export const ACTIONS = {
  async test_connection(hub, { config, rawConfig }) {
    logger.info('Action test_connection');
    const problem = configProblem(config, rawConfig?.decryption_key);
    if (problem) {
      return problem;
    }
    try {
      const reading = await hub.waitForTelegram(TEST_TIMEOUT_MS);
      return describe(reading);
    } catch (err) {
      return readerErrorMessage(err);
    }
  },
};
