// -----------------------------------------------------------------------------
// Calendar-date helpers.
//
// A collection happens on a DAY, not at an instant: every date of the
// integration is a "day number" (integer count of days since 1970-01-01), so
// the arithmetic never meets a time zone or a daylight-saving change. Only
// "today" depends on the clock: it is computed in Europe/Paris, whatever the
// time zone of the container (Docker images usually run in UTC).
// -----------------------------------------------------------------------------

export const TIME_ZONE = 'Europe/Paris';

const DAY_MS = 24 * 3600 * 1000;

const TODAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
});

const LONG_FORMATS = {
  fr: new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
  en: new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }),
};

const SHORT_FORMATS = {
  fr: new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }),
  en: new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }),
};

export const lang = (language) => (language === 'en' ? 'en' : 'fr');

/** Day number of a calendar date (`month` is 1-12). */
export function dayNumber(year, month, day) {
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** Calendar parts of a day number. */
export function toParts(dn) {
  const date = new Date(dn * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

const pad = (n) => String(n).padStart(2, '0');

/** `2026-10-06` */
export function toIso(dn) {
  const { year, month, day } = toParts(dn);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * Parse `YYYY-MM-DD` or `DD/MM/YYYY` (also `DD-MM-YYYY`, `DD.MM.YYYY`) into a
 * day number, or null when the text is not a valid date.
 */
export function parseDate(text) {
  const value = String(text ?? '').trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  let year;
  let month;
  let day;
  if (match) {
    [year, month, day] = match.slice(1).map(Number);
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
    if (!match) {
      return null;
    }
    [day, month, year] = match.slice(1).map(Number);
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return dayNumber(year, month, day);
}

/** Day of the week: 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday). */
export function weekday(dn) {
  return (((dn + 3) % 7) + 7) % 7;
}

/** Monday of the week of a day. */
export function mondayOf(dn) {
  return dn - weekday(dn);
}

/** ISO 8601 week number (1-53): the week of the year's first Thursday is 1. */
export function isoWeek(dn) {
  const thursday = dn - weekday(dn) + 3;
  const { year } = toParts(thursday);
  return Math.floor((thursday - dayNumber(year, 1, 1)) / 7) + 1;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today, in Paris. */
export function today(now = new Date()) {
  const parts = TODAY_FORMAT.formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return dayNumber(get('year'), get('month'), get('day'));
}

/** `mardi 6 octobre 2026` / `Tuesday 6 October 2026` */
export function formatLong(dn, language = 'fr') {
  return LONG_FORMATS[lang(language)].format(new Date(dn * DAY_MS));
}

/** `mar. 6 oct.` / `Tue 6 Oct` */
export function formatShort(dn, language = 'fr') {
  return SHORT_FORMATS[lang(language)].format(new Date(dn * DAY_MS));
}

/** `Aujourd'hui`, `Demain`, `Dans 3 jours` (and English). */
export function formatRelative(days, language = 'fr') {
  const en = lang(language) === 'en';
  if (days === 0) {
    return en ? 'Today' : "Aujourd'hui";
  }
  if (days === 1) {
    return en ? 'Tomorrow' : 'Demain';
  }
  return en ? `In ${days} days` : `Dans ${days} jours`;
}
