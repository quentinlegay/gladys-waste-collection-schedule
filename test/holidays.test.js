import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, toIso } from '../src/dates.js';
import {
  HOLIDAY_RULES,
  applyHolidayRule,
  easter,
  frenchHolidays,
  isHoliday,
} from '../src/holidays.js';

const d = (iso) => dayNumber(...iso.split('-').map(Number));

test('Easter Sunday is computed for known years', () => {
  assert.equal(toIso(easter(2025)), '2025-04-20');
  assert.equal(toIso(easter(2026)), '2026-04-05');
  assert.equal(toIso(easter(2027)), '2027-03-28');
  assert.equal(toIso(easter(2038)), '2038-04-25');
});

test('the 11 French public holidays of 2026', () => {
  const days = [...frenchHolidays(2026)].sort((a, b) => a - b).map(toIso);
  assert.deepEqual(days, [
    '2026-01-01',
    '2026-04-06', // Easter Monday
    '2026-05-01',
    '2026-05-08',
    '2026-05-14', // Ascension
    '2026-05-25', // Whit Monday
    '2026-07-14',
    '2026-08-15',
    '2026-11-01',
    '2026-11-11',
    '2026-12-25',
  ]);
  assert.ok(isHoliday(d('2027-05-06'))); // Ascension 2027
});

test('shift_week: the holiday and the next days of the week move by one day', () => {
  const rule = HOLIDAY_RULES.SHIFT_WEEK;
  // Tuesday July 14th, 2026.
  assert.equal(toIso(applyHolidayRule(d('2026-07-13'), rule)), '2026-07-13'); // Monday: before
  assert.equal(toIso(applyHolidayRule(d('2026-07-14'), rule)), '2026-07-15');
  assert.equal(toIso(applyHolidayRule(d('2026-07-17'), rule)), '2026-07-18'); // Friday → Saturday
  assert.equal(toIso(applyHolidayRule(d('2026-07-20'), rule)), '2026-07-20'); // next week
  // Whit Monday, May 25th, 2026:
  assert.equal(toIso(applyHolidayRule(d('2026-05-25'), rule)), '2026-05-26');
  assert.equal(toIso(applyHolidayRule(d('2026-05-26'), rule)), '2026-05-27');
});

test('shift_week counts every holiday of the week before the day', () => {
  // 2027: Thursday May 6th (Ascension) and Saturday May 8th, same week.
  const rule = HOLIDAY_RULES.SHIFT_WEEK;
  assert.equal(toIso(applyHolidayRule(d('2027-05-06'), rule)), '2027-05-07');
  assert.equal(toIso(applyHolidayRule(d('2027-05-08'), rule)), '2027-05-10'); // Sat → +2
});

test('a Sunday holiday shifts nothing', () => {
  // November 1st, 2026 is a Sunday.
  const rule = HOLIDAY_RULES.SHIFT_WEEK;
  assert.equal(toIso(applyHolidayRule(d('2026-11-02'), rule)), '2026-11-02');
});

test('shift_day, skip and none', () => {
  assert.equal(toIso(applyHolidayRule(d('2026-07-14'), HOLIDAY_RULES.SHIFT_DAY)), '2026-07-15');
  assert.equal(toIso(applyHolidayRule(d('2026-07-15'), HOLIDAY_RULES.SHIFT_DAY)), '2026-07-15');
  assert.equal(applyHolidayRule(d('2026-07-14'), HOLIDAY_RULES.SKIP), null);
  assert.equal(toIso(applyHolidayRule(d('2026-07-14'), HOLIDAY_RULES.NONE)), '2026-07-14');
});
