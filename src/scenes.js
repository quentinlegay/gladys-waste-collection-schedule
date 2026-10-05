// -----------------------------------------------------------------------------
// Scene trigger `collection_reminder` (manifest `scene_triggers`).
//
// Fired at a chosen moment before a collection — "the day before at 19:00",
// "the same day at 06:00" — to send a notification from a scene. The scene
// author filters on:
//   - `waste_type`: one type, or `all` = ONE event per collection day listing
//     every type collected that day (no double notification when household
//     waste and recycling share a day);
//   - `moment`: one of MOMENTS.
// The event carries the variables `waste_label`, `date` and `days_before`,
// usable in the message ("Sortez : {{triggerEvent.data.waste_label}}").
//
// Keys (trigger, fields, option values, variables) are stored by the scenes:
// never rename them once published.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatLong, parisMinute } from './dates.js';
import { WASTE_TYPES } from './wasteTypes.js';

const logger = createLogger({ name: 'scenes' });

export const TRIGGER_COLLECTION_REMINDER = 'collection_reminder';
export const ALL_TYPES = 'all';

const eve = (hour) => ({ key: `eve_${hour}`, daysBefore: 1, hour });
const sameDay = (hour) => ({ key: `day_${String(hour).padStart(2, '0')}`, daysBefore: 0, hour });

// When a reminder can fire. Values of the `moment` select (frozen keys).
export const MOMENTS = [...[17, 18, 19, 20, 21, 22].map(eve), ...[5, 6, 7, 8, 12].map(sameDay)];

// How often the watcher looks for due reminders.
export const WATCH_INTERVAL_MS = 60 * 1000;
// After a pause (disconnection, restart, slow download), a reminder up to 30
// minutes late is still useful; an older one is dropped.
export const MAX_CATCH_UP_MINUTES = 30;

// Event strings are capped at 1000 characters by the core.
const cap = (text) => String(text ?? '').slice(0, 1000);

const joinLabels = (labels, language) => {
  if (labels.length <= 1) return labels.join('');
  const and = language === 'en' ? ' and ' : ' et ';
  return `${labels.slice(0, -1).join(', ')}${and}${labels.at(-1)}`;
};

/**
 * Reminders due in ]from, to] (Paris minute counts, see parisMinute).
 * @param {import('./schedule.js').Schedule} schedule
 * @param {number} from
 * @param {number} to
 * @param {string} [language]
 * @returns {object[]} flat event data, keys = trigger fields + variables
 */
export function findDueReminders(schedule, from, to, language = 'fr') {
  const events = [];
  for (const moment of MOMENTS) {
    // Days on which this moment falls in the window, then the collection day
    // it announces.
    for (let fireDay = Math.floor(from / 1440); fireDay <= Math.floor(to / 1440); fireDay += 1) {
      const instant = fireDay * 1440 + moment.hour * 60;
      if (instant <= from || instant > to) continue;
      const day = fireDay + moment.daysBefore;
      const collected = schedule.types.filter((t) => t.days.includes(day));
      if (!collected.length) continue;
      const base = {
        moment: moment.key,
        date: cap(formatLong(day, language)),
        days_before: moment.daysBefore,
      };
      for (const type of collected) {
        events.push({ ...base, waste_type: type.key, waste_label: cap(type.label) });
      }
      events.push({
        ...base,
        waste_type: ALL_TYPES,
        waste_label: cap(
          joinLabels(
            collected.map((t) => t.label),
            language,
          ),
        ),
      });
    }
  }
  return events;
}

/**
 * Watch the schedule and fire `collection_reminder` once per moment, day and
 * type.
 * @param {object} gladys SDK instance
 * @param {{ getSchedule: () => Promise<import('./schedule.js').Schedule>, getLanguage: () => string }} options
 */
export function createReminderWatcher(gladys, { getSchedule, getLanguage }) {
  let timer = null;
  let lastCheck = null;

  async function check(now = new Date()) {
    const current = parisMinute(now);
    if (lastCheck === null) {
      // First check: start from now, never replay the past (a restart would
      // send the evening's reminders again).
      lastCheck = current;
      return [];
    }
    const from = Math.max(lastCheck, current - MAX_CATCH_UP_MINUTES);
    if (current <= from) {
      return [];
    }
    const schedule = await getSchedule();
    lastCheck = current;
    const events = findDueReminders(schedule, from, current, getLanguage());
    for (const event of events) {
      logger.info(
        `collection_reminder (${event.moment}, ${event.waste_type}) -> ${event.waste_label}`,
      );
      try {
        await gladys.publishSceneEvent(TRIGGER_COLLECTION_REMINDER, event);
      } catch (err) {
        // One refused event must not hide the others.
        logger.error(`collection_reminder refused (${event.moment}, ${event.waste_type})`, err);
      }
    }
    return events;
  }

  return {
    check,
    start() {
      this.stop();
      lastCheck = null;
      check().catch(() => {});
      timer = setInterval(() => {
        check().catch((err) => logger.error('Reminder check failed', err));
      }, WATCH_INTERVAL_MS);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}

/** Options of the `waste_type` field, for the manifest test. */
export const WASTE_TYPE_OPTIONS = [ALL_TYPES, ...WASTE_TYPES.map((t) => t.key)];
