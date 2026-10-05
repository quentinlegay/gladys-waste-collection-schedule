// -----------------------------------------------------------------------------
// Entry point of the "Waste Collection" Gladys external integration.
//
// Role of this file: wire the SDK to the schedule (src/schedule.js) and to the
// devices (src/devices/). It holds NO schedule logic. It only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. connects, publishes the discovered devices and their states.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createActions } from './src/actions.js';
import { normalizeConfig } from './src/config.js';
import { today } from './src/dates.js';
import {
  buildAllStates,
  buildDiscoveredDevices,
  createStatePublisher,
} from './src/devices/index.js';
import { createScheduleService } from './src/schedule.js';
import { createReminderWatcher } from './src/scenes.js';
import { WIDGET_UPCOMING_COLLECTIONS, buildUpcomingWidget } from './src/widget.js';

const gladys = new GladysIntegration();
const service = createScheduleService();
const actions = createActions(service);

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

// Houses of Gladys with their position (manifest `location: true`): they
// locate the collections when no address is typed. There is no update event:
// read again on (re)connection, on config change and on "Preview".
let houses = [];

async function loadHouses() {
  try {
    houses = await gladys.getHouses();
  } catch (err) {
    // Keep the previous list: a transient error must not lose the sector.
    logger.warn('Cannot read the houses of Gladys', err.message);
  }
}

const getSchedule = (options = {}) => service.getSchedule(config, { ...options, houses });

// Fires the `collection_reminder` scene trigger at the chosen moments.
const reminders = createReminderWatcher(gladys, {
  getSchedule: () => getSchedule(),
  getLanguage: () => config.language,
});

// Publishes only the sensor values that changed.
const states = createStatePublisher(gladys);

// What was last sent to Gladys, to avoid sending the same thing again.
let lastDevicesKey = null;
let lastStatusKey = null;
let lastScheduleKey = null;

// The refresh running now: the polls of every device arrive at the same
// minute and share it; a forced refresh waits for it, then runs its own.
let running = null;

function refresh({ force = false } = {}) {
  if (running && !force) {
    return running;
  }
  const previous = running ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => doRefresh({ force }))
    .finally(() => {
      if (running === current) running = null;
    });
  running = current;
  return current;
}

/**
 * Compute the schedule, then bring Gladys up to date: discovered devices when
 * the waste types changed, sensor states, connection status, widget.
 */
async function doRefresh({ force }) {
  const schedule = await getSchedule({ force });

  const devicesKey = JSON.stringify([config.language, schedule.types.map((t) => [t.key, t.label])]);
  if (devicesKey !== lastDevicesKey) {
    await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config, schedule));
    lastDevicesKey = devicesKey;
  }

  await states.publish(buildAllStates(gladys, config, schedule));
  await reportStatus(schedule);

  const scheduleKey = JSON.stringify([schedule.today, schedule.types]);
  if (scheduleKey !== lastScheduleKey) {
    lastScheduleKey = scheduleKey;
    try {
      gladys.requestWidgetRefresh(WIDGET_UPCOMING_COLLECTIONS);
    } catch (err) {
      logger.debug('Widget refresh request failed', err);
    }
  }
  return schedule;
}

// Connected when the schedule has no blocking problem; otherwise show the
// first one in the Configuration screen.
async function reportStatus(schedule) {
  const error = schedule.errors[0] ?? null;
  const key = JSON.stringify(error);
  if (key === lastStatusKey) {
    return;
  }
  lastStatusKey = key;
  if (error) {
    logger.warn(`Schedule problem: ${error.en}`);
  }
  await gladys
    .setConnectionStatus(!error, error ?? undefined)
    .catch((err) => logger.error('setConnectionStatus failed', err));
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> publishing discovered devices');
  lastDevicesKey = null;
  await refresh();
});

// --- Polling: Gladys asks to refresh a device --------------------------------
// Called every minute for each created device. The schedule is cached: this
// only downloads it when it is old, and only publishes the changed values.
gladys.onPoll(async () => {
  await refresh();
});

// --- Manifest actions: buttons in the Configuration screen -------------------
for (const [actionKey, handler] of Object.entries(actions)) {
  gladys.onAction(actionKey, async (fields) => {
    await loadHouses();
    const message = await handler(gladys, { fields, config, houses, today: today() });
    // A forced download may have changed the schedule: apply it right away.
    await refresh().catch((err) => logger.error('Refresh after action failed', err));
    return message;
  });
}

// --- Dashboard widget: Gladys pulls the content to display -------------------
gladys.onWidgetGet(WIDGET_UPCOMING_COLLECTIONS, async ({ settings, language }) =>
  buildUpcomingWidget(gladys, await getSchedule(), { settings, language }),
);

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  await loadHouses();
  await refresh({ force: true });
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  try {
    // 1) Fetch the config filled in by the user.
    config = normalizeConfig(await gladys.getConfig());
    await loadHouses();
    // 2) Gladys may have restarted: publish the devices and every value again.
    lastDevicesKey = null;
    lastStatusKey = null;
    states.reset();
    // 3) Watch the reminder moments. Started before the download below, so a
    // download failure does not stop it.
    reminders.start();
    await refresh();
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    lastStatusKey = null;
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

gladys.on('disconnected', () => {
  reminders.stop();
});

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  reminders.stop();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Waste Collection integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
