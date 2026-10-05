import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayNumber,
  formatLong,
  formatRelative,
  isoWeek,
  parseDate,
  toIso,
  today,
  weekday,
} from '../src/dates.js';

test('day numbers round-trip through ISO dates', () => {
  assert.equal(dayNumber(1970, 1, 1), 0);
  assert.equal(toIso(dayNumber(2026, 10, 6)), '2026-10-06');
  assert.equal(toIso(dayNumber(2028, 2, 29)), '2028-02-29');
});

test('weekday is 0 for Monday and 6 for Sunday', () => {
  assert.equal(weekday(dayNumber(2026, 10, 5)), 0); // Monday
  assert.equal(weekday(dayNumber(2026, 10, 6)), 1); // Tuesday
  assert.equal(weekday(dayNumber(2026, 10, 11)), 6); // Sunday
});

test('isoWeek follows ISO 8601, including 53-week years', () => {
  assert.equal(isoWeek(dayNumber(2026, 1, 1)), 1); // Thursday
  assert.equal(isoWeek(dayNumber(2026, 10, 12)), 42);
  assert.equal(isoWeek(dayNumber(2026, 12, 31)), 53); // 2026 has 53 weeks
  assert.equal(isoWeek(dayNumber(2027, 1, 3)), 53); // still week 53 of 2026
  assert.equal(isoWeek(dayNumber(2027, 1, 4)), 1);
  assert.equal(isoWeek(dayNumber(2024, 12, 30)), 1); // week 1 of 2025
});

test('parseDate accepts ISO and French dates, rejects invalid ones', () => {
  assert.equal(parseDate('2026-01-09'), dayNumber(2026, 1, 9));
  assert.equal(parseDate('09/01/2026'), dayNumber(2026, 1, 9));
  assert.equal(parseDate('9.1.2026'), dayNumber(2026, 1, 9));
  assert.equal(parseDate('2026-02-30'), null);
  assert.equal(parseDate('31/04/2026'), null);
  assert.equal(parseDate('demain'), null);
  assert.equal(parseDate(undefined), null);
});

test('today is the calendar day in Paris, whatever the container time zone', () => {
  // 22:30 UTC on Oct 5 is already Oct 6 in Paris (UTC+2 in summer time).
  assert.equal(toIso(today(new Date('2026-10-05T22:30:00Z'))), '2026-10-06');
  // 23:30 UTC on Dec 31 is Jan 1 in Paris (UTC+1 in winter).
  assert.equal(toIso(today(new Date('2026-12-31T23:30:00Z'))), '2027-01-01');
  assert.equal(toIso(today(new Date('2026-10-05T21:30:00Z'))), '2026-10-05');
});

test('formatting is localized', () => {
  const dn = dayNumber(2026, 10, 6);
  assert.equal(formatLong(dn, 'fr'), 'mardi 6 octobre 2026');
  assert.match(formatLong(dn, 'en'), /Tuesday.*6 October 2026/);
  assert.equal(formatRelative(0, 'fr'), "Aujourd'hui");
  assert.equal(formatRelative(1, 'en'), 'Tomorrow');
  assert.equal(formatRelative(4, 'fr'), 'Dans 4 jours');
});
