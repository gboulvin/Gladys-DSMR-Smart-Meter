// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
//   - p1_overview: live consumed/injected power, today's totals (electricity,
//     gas, water), the current tariff, the connection to the P1 reader and a
//     power chart;
//   - p1_phases: current of each phase against the fuse rating, voltages,
//     voltage sags/swells and power failures — what tells you which phase to
//     plug the heat pump on, or why the lights flicker.
//
// The tiles and the chart are bound to device features (`device_feature`):
// they move live with the published states, nothing to refresh. The status
// rows are computed here (today's totals, connection): the core caches them
// for `ttl_seconds`, and the hub nudges the widgets when the connection or
// the meter layout changes.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { READER_STATUS } from './dsmr/reader.js';
import { PHASES } from './dsmr/parser.js';
import { electricityFeatureId, mbusIndexFeatureId } from './devices/index.js';
import { formatNumber, t } from './i18n.js';

const logger = createLogger({ name: 'widgets' });

export const WIDGET_KEYS = { OVERVIEW: 'p1_overview', PHASES: 'p1_phases' };

export const CHART_INTERVALS = ['last-hour', 'last-twelve-hours', 'last-day', 'last-week'];
export const DEFAULT_CHART_INTERVAL = 'last-day';
export const DEFAULT_FUSE_RATING = 25;

const CONTENT_TTL_SECONDS = 60;

const WAITING_TEXT = t(
  'Waiting for the first telegram of the P1 reader. Check the address in the integration configuration.',
  "En attente du premier télégramme du lecteur P1. Vérifiez l'adresse dans la configuration de l'intégration.",
  'Warten auf das erste Telegramm des P1-Lesers. Prüfen Sie die Adresse in der Konfiguration der Integration.',
  'Esperando el primer telegrama del lector P1. Compruebe la dirección en la configuración de la integración.',
);

function connectionRow(hub, language) {
  if (hub.status === READER_STATUS.CONNECTED && hub.lastTelegramAt !== null) {
    const seconds = Math.max(0, Math.round((hub.now() - hub.lastTelegramAt) / 1000));
    const n = formatNumber(seconds, language);
    return {
      label: t('Last telegram', 'Dernier télégramme', 'Letztes Telegramm', 'Último telegrama'),
      icon: 'wifi',
      value: t(`${n} s ago`, `il y a ${n} s`, `vor ${n} s`, `hace ${n} s`),
      color: seconds > 120 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    };
  }
  const connecting = hub.status === READER_STATUS.CONNECTING;
  return {
    label: t('P1 reader', 'Lecteur P1', 'P1-Leser', 'Lector P1'),
    icon: 'wifi-off',
    value: connecting
      ? t('Connecting…', 'Connexion…', 'Verbindung…', 'Conectando…')
      : t('Unreachable', 'Injoignable', 'Nicht erreichbar', 'Inaccesible'),
    color: connecting ? WIDGET_COLORS.INFO : WIDGET_COLORS.DANGER,
  };
}

const quantity = (value, unit, language, decimals) =>
  `${formatNumber(value, language, decimals)} ${unit}`;

function overviewContent(gladys, hub, { settings, language }) {
  const reading = hub.reading;
  if (!reading) {
    return {
      ttl_seconds: CONTENT_TTL_SECONDS,
      components: [
        { type: 'text', variant: 'body', text: WAITING_TEXT },
        { type: 'status', items: [connectionRow(hub, language)] },
      ],
    };
  }
  const { electricity } = reading;
  const summary = hub.daily.summary();
  const featureId = (key) => electricityFeatureId(gladys, reading, key);
  const gasFeature = mbusIndexFeatureId(gladys, reading, 'gas');

  const tiles = [];
  if (electricity.importPower !== null) {
    tiles.push({
      type: 'value',
      label: t('Consumed', 'Consommé', 'Bezug', 'Consumido'),
      icon: 'zap',
      device_feature: featureId('import-power'),
    });
  }
  if (electricity.exportPower !== null) {
    tiles.push({
      type: 'value',
      label: t('Injected', 'Injecté', 'Einspeisung', 'Inyectado'),
      icon: 'sun',
      device_feature: featureId('export-power'),
    });
  }
  if (gasFeature) {
    tiles.push({
      type: 'value',
      label: t('Gas index', 'Index gaz', 'Gaszähler', 'Índice gas'),
      icon: 'thermometer',
      device_feature: gasFeature,
    });
  }

  const rows = [];
  if (reading.tariff !== null) {
    rows.push({
      label: t('Current tariff', 'Tarif en cours', 'Aktueller Tarif', 'Tarifa actual'),
      icon: 'clock',
      value: t(
        `Tariff ${reading.tariff}`,
        `Tarif ${reading.tariff}`,
        `Tarif ${reading.tariff}`,
        `Tarifa ${reading.tariff}`,
      ),
      color: WIDGET_COLORS.PRIMARY,
    });
  }
  if (summary?.consumption !== null && summary?.consumption !== undefined) {
    rows.push({
      label: t('Consumed today', "Consommé aujourd'hui", 'Heute bezogen', 'Consumido hoy'),
      icon: 'activity',
      value: quantity(summary.consumption, 'kWh', language, 2),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (summary?.injection !== null && summary?.injection !== undefined) {
    rows.push({
      label: t('Injected today', "Injecté aujourd'hui", 'Heute eingespeist', 'Inyectado hoy'),
      icon: 'sun',
      value: quantity(summary.injection, 'kWh', language, 2),
      color: WIDGET_COLORS.SUCCESS,
    });
  }
  if (summary?.gas !== null && summary?.gas !== undefined) {
    rows.push({
      label: t('Gas today', "Gaz aujourd'hui", 'Gas heute', 'Gas hoy'),
      icon: 'thermometer',
      value: quantity(summary.gas, 'm³', language, 3),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (summary?.water !== null && summary?.water !== undefined) {
    rows.push({
      label: t('Water today', "Eau aujourd'hui", 'Wasser heute', 'Agua hoy'),
      icon: 'droplet',
      value: quantity(summary.water, 'm³', language, 3),
      color: WIDGET_COLORS.INFO,
    });
  }
  if (summary && electricity.importPower !== null) {
    rows.push({
      label: t(
        'Peak power today',
        "Pic de puissance aujourd'hui",
        'Spitzenleistung heute',
        'Pico de potencia hoy',
      ),
      icon: 'trending-up',
      value: quantity(summary.peakPower, 'W', language, 0),
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (electricity.monthPeakDemand !== null) {
    rows.push({
      label: t('Peak demand this month', 'Pointe du mois', 'Monatsspitze', 'Pico del mes'),
      icon: 'bar-chart-2',
      value: quantity(electricity.monthPeakDemand, 'W', language, 0),
      color: WIDGET_COLORS.WARNING,
    });
  }
  rows.push(connectionRow(hub, language));

  const chartFeatures = ['import-power', 'export-power']
    .filter((key) => electricity[key === 'import-power' ? 'importPower' : 'exportPower'] !== null)
    .map(featureId);
  const interval = CHART_INTERVALS.includes(settings?.chart_interval)
    ? settings.chart_interval
    : DEFAULT_CHART_INTERVAL;

  const components = [...tiles, { type: 'status', items: rows.slice(0, 10) }];
  if (chartFeatures.length > 0) {
    components.push({
      type: 'chart',
      chart_type: 'area',
      title: t('Grid power', 'Puissance réseau', 'Netzleistung', 'Potencia de red'),
      device_features: chartFeatures,
      interval,
    });
  }
  return { ttl_seconds: CONTENT_TTL_SECONDS, components };
}

function phasesContent(gladys, hub, { settings, language }) {
  const reading = hub.reading;
  if (!reading) {
    return {
      ttl_seconds: CONTENT_TTL_SECONDS,
      components: [
        { type: 'text', variant: 'body', text: WAITING_TEXT },
        { type: 'status', items: [connectionRow(hub, language)] },
      ],
    };
  }
  const { electricity } = reading;
  const fuse = Number(settings?.fuse_rating);
  const fuseRating = Number.isFinite(fuse) && fuse > 0 ? fuse : DEFAULT_FUSE_RATING;
  const featureId = (key) => electricityFeatureId(gladys, reading, key);
  const phases = Object.keys(PHASES).filter((phase) => electricity.phases[phase]);

  const gauges = [];
  const voltages = [];
  const rows = [];
  for (const phase of phases) {
    const values = electricity.phases[phase];
    const label = phase.toUpperCase();
    if (values.current !== null) {
      gauges.push({
        type: 'gauge',
        label: t(`Current ${label}`, `Courant ${label}`, `Strom ${label}`, `Corriente ${label}`),
        min: 0,
        max: fuseRating,
        device_feature: featureId(`${phase}-current`),
        color: values.current >= fuseRating * 0.9 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.PRIMARY,
      });
    }
    if (values.voltage !== null) {
      voltages.push({
        type: 'value',
        label: t(`Voltage ${label}`, `Tension ${label}`, `Spannung ${label}`, `Tensión ${label}`),
        icon: 'activity',
        device_feature: featureId(`${phase}-voltage`),
      });
    }
    if (values.sags !== null || values.swells !== null) {
      const sags = formatNumber(values.sags ?? 0, language);
      const swells = formatNumber(values.swells ?? 0, language);
      rows.push({
        label: t(
          `Voltage sags / swells ${label}`,
          `Creux / pics de tension ${label}`,
          `Spannungseinbrüche / -spitzen ${label}`,
          `Huecos / picos de tensión ${label}`,
        ),
        icon: 'alert-triangle',
        value: `${sags} / ${swells}`,
        color:
          (values.sags ?? 0) + (values.swells ?? 0) > 0
            ? WIDGET_COLORS.WARNING
            : WIDGET_COLORS.SUCCESS,
      });
    }
  }
  if (electricity.powerFailures !== null) {
    rows.push({
      label: t('Power failures', 'Coupures de courant', 'Stromausfälle', 'Cortes de luz'),
      icon: 'power',
      value: electricity.powerFailures,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  if (electricity.longPowerFailures !== null) {
    rows.push({
      label: t('Long power failures', 'Coupures longues', 'Lange Stromausfälle', 'Cortes largos'),
      icon: 'power',
      value: electricity.longPowerFailures,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  rows.push(connectionRow(hub, language));

  const components = [...gauges, ...voltages].slice(0, 6);
  components.push({ type: 'status', items: rows.slice(0, 10) });
  const currentFeatures = phases
    .filter((phase) => electricity.phases[phase].current !== null)
    .map((phase) => featureId(`${phase}-current`));
  if (currentFeatures.length > 0) {
    components.push({
      type: 'chart',
      chart_type: 'line',
      title: t('Current per phase', 'Courant par phase', 'Strom je Phase', 'Corriente por fase'),
      device_features: currentFeatures,
      interval: DEFAULT_CHART_INTERVAL,
    });
  }
  return { ttl_seconds: CONTENT_TTL_SECONDS, components };
}

export const WIDGETS = {
  [WIDGET_KEYS.OVERVIEW]: {
    async get(gladys, hub, request) {
      logger.debug(`onWidgetGet <- ${WIDGET_KEYS.OVERVIEW}`);
      return overviewContent(gladys, hub, request);
    },
  },
  [WIDGET_KEYS.PHASES]: {
    async get(gladys, hub, request) {
      logger.debug(`onWidgetGet <- ${WIDGET_KEYS.PHASES}`);
      return phasesContent(gladys, hub, request);
    },
  },
};

/**
 * Ask the core to re-pull every widget now (connection or layout changed).
 * Fire-and-forget, rate-limited core-side to 1 per 10 s per widget.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
