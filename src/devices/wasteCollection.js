// -----------------------------------------------------------------------------
// Devices.
//
//   - one device per waste type of the schedule ("Collecte Ordures ménagères"),
//     platform id = the frozen waste type key (src/wasteTypes.js);
//   - one summary device "Prochaine collecte", whatever the type.
//
// Each carries two read-only sensors:
//   - `days_until` (duration, days): 0 = today, 1 = tomorrow… The one to use
//     in scenes: "every day at 19:00, if days_until = 1, notify me";
//   - `next_date` (text): "mardi 6 octobre 2026" (and the types, on the
//     summary device).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { formatLong, lang } from '../dates.js';
import { HORIZON_DAYS, nextCollections } from '../schedule.js';

export const DEVICE_TYPE = 'waste-collection';
export const SUMMARY_TYPE = 'waste-summary';
export const SUMMARY_ID = 'next';

export const FEATURE = {
  DAYS_UNTIL: 'days_until',
  NEXT_DATE: 'next_date',
};

const TEXTS = {
  device: { fr: (label) => `Collecte ${label}`, en: (label) => `Collection ${label}` },
  summary: { fr: 'Prochaine collecte', en: 'Next collection' },
  daysUntil: { fr: 'Jours avant la collecte', en: 'Days until collection' },
  nextDate: { fr: 'Prochaine collecte', en: 'Next collection' },
  nextTypes: { fr: 'Prochaine collecte (types et date)', en: 'Next collection (types and date)' },
  none: { fr: 'Aucune collecte prévue', en: 'No collection scheduled' },
};

function features(ids, language, textName) {
  const l = lang(language);
  return [
    {
      name: TEXTS.daysUntil[l],
      external_id: ids.feature(FEATURE.DAYS_UNTIL),
      category: DEVICE_FEATURE_CATEGORIES.DURATION,
      type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
      unit: DEVICE_FEATURE_UNITS.DAYS,
      min: 0,
      max: HORIZON_DAYS,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    },
    {
      name: textName,
      external_id: ids.feature(FEATURE.NEXT_DATE),
      category: DEVICE_FEATURE_CATEGORIES.TEXT,
      type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
      read_only: true,
      has_feedback: false,
      keep_history: false,
    },
  ];
}

function states(ids, next, text) {
  return [
    // No upcoming day: the maximum, never a stale "0" or "1" a scene would
    // take for a collection today or tomorrow.
    {
      device_feature_external_id: ids.feature(FEATURE.DAYS_UNTIL),
      state: next ? next.inDays : HORIZON_DAYS,
    },
    { device_feature_external_id: ids.feature(FEATURE.NEXT_DATE), text },
  ];
}

export const wasteDevice = {
  deviceExternalId(gladys, key) {
    return gladys.externalIds(DEVICE_TYPE, key).device;
  },

  buildDevice(gladys, type, config) {
    const ids = gladys.externalIds(DEVICE_TYPE, type.key);
    const l = lang(config.language);
    return {
      name: TEXTS.device[l](type.label),
      external_id: ids.device,
      // Gladys calls onPoll at this interval (in MILLISECONDS).
      poll_frequency: config.poll_frequency,
      features: features(ids, l, TEXTS.nextDate[l]),
    };
  },

  /** @param {import('../schedule.js').Schedule} schedule */
  buildStates(gladys, type, schedule, language) {
    const ids = gladys.externalIds(DEVICE_TYPE, type.key);
    const day = type.days[0];
    const next = day === undefined ? null : { day, inDays: day - schedule.today };
    return states(ids, next, next ? formatLong(next.day, language) : TEXTS.none[lang(language)]);
  },
};

export const summaryDevice = {
  deviceExternalId(gladys) {
    return gladys.externalIds(SUMMARY_TYPE, SUMMARY_ID).device;
  },

  buildDevice(gladys, config) {
    const ids = gladys.externalIds(SUMMARY_TYPE, SUMMARY_ID);
    const l = lang(config.language);
    return {
      name: TEXTS.summary[l],
      external_id: ids.device,
      poll_frequency: config.poll_frequency,
      features: features(ids, l, TEXTS.nextTypes[l]),
    };
  },

  /** @param {import('../schedule.js').Schedule} schedule */
  buildStates(gladys, schedule, language) {
    const ids = gladys.externalIds(SUMMARY_TYPE, SUMMARY_ID);
    const all = nextCollections(schedule);
    if (!all.length) {
      return states(ids, null, TEXTS.none[lang(language)]);
    }
    const first = all.filter((c) => c.day === all[0].day);
    const text = `${first.map((c) => c.label).join(', ')} — ${formatLong(first[0].day, language)}`;
    return states(ids, first[0], text);
  },
};
