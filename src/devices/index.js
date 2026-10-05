// -----------------------------------------------------------------------------
// Device registry: the summary device + one device per waste type of the
// current schedule.
// -----------------------------------------------------------------------------

import { DEVICE_TYPE, SUMMARY_TYPE, summaryDevice, wasteDevice } from './wasteCollection.js';

/**
 * Build the discovery payload for Gladys.
 * @param {import('../schedule.js').Schedule|null} schedule
 */
export function buildDiscoveredDevices(gladys, config, schedule) {
  return [
    summaryDevice.buildDevice(gladys, config),
    ...(schedule?.types ?? []).map((type) => wasteDevice.buildDevice(gladys, type, config)),
  ];
}

/**
 * Every state of every device of a schedule.
 * @param {import('../schedule.js').Schedule} schedule
 */
export function buildAllStates(gladys, config, schedule) {
  return [
    ...summaryDevice.buildStates(gladys, schedule, config.language),
    ...schedule.types.flatMap((type) =>
      wasteDevice.buildStates(gladys, type, schedule, config.language),
    ),
  ];
}

/**
 * Waste type key of a device of this integration ('next' for the summary
 * device), or null when the external_id is not one of ours.
 */
export function deviceKey(gladys, externalId) {
  for (const type of [DEVICE_TYPE, SUMMARY_TYPE]) {
    const prefix = gladys.externalIds(type, '').device;
    if (String(externalId ?? '').startsWith(prefix)) {
      return String(externalId).slice(prefix.length) || null;
    }
  }
  return null;
}

/**
 * Publish only the states that changed: the host API accepts 300 states per
 * minute per integration, and every device is polled every minute.
 */
export function createStatePublisher(gladys) {
  const lastValues = new Map();
  return {
    async publish(states) {
      const value = (s) => (s.text !== undefined ? `t:${s.text}` : `s:${s.state}`);
      const changed = states.filter(
        (s) => lastValues.get(s.device_feature_external_id) !== value(s),
      );
      // 100 states per request at most.
      for (let i = 0; i < changed.length; i += 100) {
        await gladys.publishStates(changed.slice(i, i + 100));
      }
      for (const s of changed) {
        lastValues.set(s.device_feature_external_id, value(s));
      }
      return changed.length;
    },
    // After a reconnection, Gladys may have restarted: publish everything again.
    reset() {
      lastValues.clear();
    },
  };
}
