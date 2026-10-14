// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of the manifest;
// this module provides the defaults and normalizes the received object, so the
// rest of the code never deals with `undefined` or numbers typed as strings.
// -----------------------------------------------------------------------------

import { normalizeKey } from './dsmr/decrypt.js';

export const CONNECTION_TYPES = { TCP: 'tcp', HTTP: 'http' };

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  connection_type: CONNECTION_TYPES.TCP,
  host: '',
  port: 23,
  http_url: '',
  // Luxembourg (Smarty) only: the meter encrypts its telegrams. Secret field,
  // so no manifest default.
  decryption_key: '',
  // Seconds between two publications of the readings to Gladys. A DSMR 5 meter
  // sends a telegram every second: Gladys accepts 300 states a minute.
  publish_interval: 10,
};

export const PUBLISH_INTERVAL_BOUNDS = { min: 5, max: 300 };

function clamp(value, { min, max }, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const connectionType = Object.values(CONNECTION_TYPES).includes(raw.connection_type)
    ? raw.connection_type
    : DEFAULT_CONFIG.connection_type;
  return {
    ...DEFAULT_CONFIG,
    connection_type: connectionType,
    host: String(raw.host ?? DEFAULT_CONFIG.host).trim(),
    port: clamp(raw.port, { min: 1, max: 65535 }, DEFAULT_CONFIG.port),
    http_url: String(raw.http_url ?? DEFAULT_CONFIG.http_url).trim(),
    decryption_key: normalizeKey(raw.decryption_key),
    publish_interval: clamp(
      raw.publish_interval,
      PUBLISH_INTERVAL_BOUNDS,
      DEFAULT_CONFIG.publish_interval,
    ),
  };
}

/**
 * What is missing for the integration to connect, as a multi-language
 * message, or `null` when the config is complete.
 */
export function configProblem(config, rawKey) {
  if (config.connection_type === CONNECTION_TYPES.HTTP) {
    if (!/^https?:\/\/.+/i.test(config.http_url)) {
      return {
        en: 'Enter the URL of the P1 reader (e.g. http://192.168.1.50/api/v1/telegram).',
        fr: "Saisissez l'URL du lecteur P1 (ex. http://192.168.1.50/api/v1/telegram).",
        de: 'Geben Sie die URL des P1-Lesers ein (z. B. http://192.168.1.50/api/v1/telegram).',
        es: 'Introduzca la URL del lector P1 (p. ej. http://192.168.1.50/api/v1/telegram).',
      };
    }
  } else if (!config.host) {
    return {
      en: 'Enter the IP address or host name of the P1 reader.',
      fr: "Saisissez l'adresse IP ou le nom d'hôte du lecteur P1.",
      de: 'Geben Sie die IP-Adresse oder den Hostnamen des P1-Lesers ein.',
      es: 'Introduzca la dirección IP o el nombre de host del lector P1.',
    };
  }
  if (rawKey && !config.decryption_key) {
    return {
      en: 'The decryption key must hold 32 hexadecimal characters.',
      fr: 'La clé de déchiffrement doit compter 32 caractères hexadécimaux.',
      de: 'Der Entschlüsselungsschlüssel muss aus 32 Hexadezimalzeichen bestehen.',
      es: 'La clave de descifrado debe tener 32 caracteres hexadecimales.',
    };
  }
  return null;
}
