// -----------------------------------------------------------------------------
// French public holidays, and how a custom schedule reacts to them.
//
// Providers already publish the shifted dates (that is why they are more
// reliable). A custom schedule only knows "every Tuesday": the holiday rule
// chosen in the configuration reproduces what most French collection services
// do, the most common being "the holiday and the following days of the week
// are collected one day later".
// -----------------------------------------------------------------------------

import { dayNumber, mondayOf, toParts, weekday } from './dates.js';

export const HOLIDAY_RULES = {
  // No change: the collection happens even on a public holiday.
  NONE: 'none',
  // The holiday and the next collection days of the same week shift by one
  // day (Monday holiday: Monday → Tuesday, Tuesday → Wednesday… Friday →
  // Saturday). The usual rule in France, and SMICTOM Valcobreizh's.
  SHIFT_WEEK: 'shift_week',
  // Only a collection falling on the holiday moves to the next day.
  SHIFT_DAY: 'shift_day',
  // A collection falling on the holiday is cancelled.
  SKIP: 'skip',
};

/** Easter Sunday (anonymous Gregorian algorithm), as a day number. */
export function easter(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dayNumber(year, month, day);
}

const cache = new Map();

/** Set of the 11 French public holidays of a year (day numbers). */
export function frenchHolidays(year) {
  if (!cache.has(year)) {
    const e = easter(year);
    cache.set(
      year,
      new Set([
        dayNumber(year, 1, 1), // Jour de l'an
        e + 1, // Lundi de Pâques
        dayNumber(year, 5, 1), // Fête du travail
        dayNumber(year, 5, 8), // Victoire 1945
        e + 39, // Ascension
        e + 50, // Lundi de Pentecôte
        dayNumber(year, 7, 14), // Fête nationale
        dayNumber(year, 8, 15), // Assomption
        dayNumber(year, 11, 1), // Toussaint
        dayNumber(year, 11, 11), // Armistice
        dayNumber(year, 12, 25), // Noël
      ]),
    );
  }
  return cache.get(year);
}

export function isHoliday(dn) {
  return frenchHolidays(toParts(dn).year).has(dn);
}

/**
 * Apply a holiday rule to ONE collection day.
 * @param {number} dn the regular collection day
 * @param {string} rule one of HOLIDAY_RULES
 * @returns {number|null} the actual day, or null when cancelled
 */
export function applyHolidayRule(dn, rule) {
  switch (rule) {
    case HOLIDAY_RULES.SHIFT_DAY:
      return isHoliday(dn) ? dn + 1 : dn;
    case HOLIDAY_RULES.SKIP:
      return isHoliday(dn) ? null : dn;
    case HOLIDAY_RULES.SHIFT_WEEK: {
      // Sunday is never collected: a Sunday holiday shifts nothing.
      if (weekday(dn) === 6) {
        return dn;
      }
      let shift = 0;
      for (let day = mondayOf(dn); day <= dn; day += 1) {
        if (weekday(day) !== 6 && isHoliday(day)) {
          shift += 1;
        }
      }
      return dn + shift;
    }
    default:
      return dn;
  }
}
