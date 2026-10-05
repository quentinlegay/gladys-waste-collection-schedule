// -----------------------------------------------------------------------------
// Dashboard widget `upcoming_collections` (manifest `widgets`).
//
// A `card-list` of the next collections (one row per type and day), with a
// badge for today and tomorrow. Its content lives until the next midnight in
// Paris at most (`ttl_seconds`), and index.js asks for a refresh whenever the
// schedule changes.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { formatRelative, formatShort, lang } from './dates.js';
import { deviceKey } from './devices/index.js';
import { upcomingCollections } from './schedule.js';

export const WIDGET_UPCOMING_COLLECTIONS = 'upcoming_collections';

// `list` display of a card-list: 1 to 8 items.
export const MAX_ITEMS = 8;
export const DEFAULT_ITEMS = 5;

const TEXTS = {
  empty: {
    fr: "Aucune collecte prévue. Vérifiez la configuration de l'intégration.",
    en: 'No collection scheduled. Check the integration configuration.',
  },
  today: { fr: "Aujourd'hui", en: 'Today' },
  tomorrow: { fr: 'Demain', en: 'Tomorrow' },
};

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Seconds until the next midnight in Paris (plus a minute of margin), bounded
 * to the 60-3600 s range the core accepts.
 */
export function ttlUntilMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const elapsed = get('hour') * 3600 + get('minute') * 60 + get('second');
  return Math.min(3600, Math.max(60, 24 * 3600 - elapsed + 60));
}

/**
 * Build the widget content.
 * @param {object} gladys
 * @param {import('./schedule.js').Schedule} schedule
 * @param {{ settings?: object, language?: string, now?: Date }} options
 */
export function buildUpcomingWidget(
  gladys,
  schedule,
  { settings = {}, language, now = new Date() },
) {
  const l = lang(language);
  const max = Math.min(MAX_ITEMS, Math.max(1, Number(settings.max_items) || DEFAULT_ITEMS));
  const devices = Array.isArray(settings.types) ? settings.types : [];
  const keys = devices.map((id) => deviceKey(gladys, id)).filter((key) => key && key !== 'next');
  const collections = upcomingCollections(schedule, keys.length ? keys : null).slice(0, max);

  if (!collections.length) {
    return {
      ttl_seconds: ttlUntilMidnight(now),
      components: [{ type: 'text', text: TEXTS.empty, variant: 'body' }],
    };
  }

  return {
    ttl_seconds: ttlUntilMidnight(now),
    components: [
      {
        type: 'card-list',
        display: 'list',
        items: collections.map((c) => {
          const item = {
            title: truncate(c.label, 60),
            subtitle: truncate(`${formatShort(c.day, l)} · ${formatRelative(c.inDays, l)}`, 60),
          };
          if (c.inDays === 0) {
            item.badge = { text: TEXTS.today[l], color: WIDGET_COLORS.DANGER };
          } else if (c.inDays === 1) {
            item.badge = { text: TEXTS.tomorrow[l], color: WIDGET_COLORS.WARNING };
          }
          return item;
        }),
      },
    ],
  };
}
