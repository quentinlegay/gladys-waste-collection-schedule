import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, toIso } from '../src/dates.js';
import { OpeningHoursError, isOpen, isSelected, parseOpeningHours } from '../src/openingHours.js';

const d = (iso) => dayNumber(...iso.split('-').map(Number));

/** Days of [from, from + count) selected by a value. */
function days(value, from, count, fn = isSelected) {
  const rules = parseOpeningHours(value);
  const out = [];
  for (let dn = d(from); dn < d(from) + count; dn += 1) {
    if (fn(rules, dn)) out.push(toIso(dn));
  }
  return out;
}

test('a weekday, times ignored', () => {
  assert.deepEqual(days('Tu 11:00-23:59', '2026-10-01', 15), ['2026-10-06', '2026-10-13']);
});

test('a dated range with ISO weeks and a step (Publidata even weeks)', () => {
  assert.deepEqual(days('2024 Mar 11-2030 Dec 30 week 02-53/2 Mo 11:00-23:59', '2026-10-01', 31), [
    '2026-10-12',
    '2026-10-26',
  ]);
  // The range ends: nothing after 2030 Dec 30.
  assert.deepEqual(days('2024 Mar 11-2030 Dec 30 week 02-53/2 Mo', '2030-12-31', 30), [
    // 2031 Jan 13 would be week 2 but is out of range.
  ]);
});

test('an outdated range selects nothing', () => {
  assert.deepEqual(
    days('2023 Jan 01-2024 Mar 11 week 01-53/2 Tu 10:00-23:59', '2026-01-01', 365),
    [],
  );
});

test('single days, open or off', () => {
  assert.deepEqual(days('2026 Jul 15 11:00-23:59', '2026-07-01', 31), ['2026-07-15']);
  const off = parseOpeningHours('2026 Jul 14 off');
  assert.equal(off[0].off, true);
  assert.equal(isSelected(off, d('2026-07-14')), true);
  assert.equal(isOpen(off, d('2026-07-14')), false);
});

test('a list of explicit days', () => {
  assert.deepEqual(days('2025 Jan 17,2026 Jan 16,2027 Jan 15 06:00-23:59', '2025-01-01', 900), [
    '2025-01-17',
    '2026-01-16',
    '2027-01-15',
  ]);
});

test('month ranges with a year, and a trailing semicolon', () => {
  const selected = days('2023 Jan-Sep off;', '2023-01-01', 365);
  assert.equal(selected[0], '2023-01-01');
  assert.equal(selected.at(-1), '2023-09-30');
  assert.equal(selected.length, 273);
});

test('nth weekday of the month, for some months', () => {
  assert.deepEqual(days('Feb,May,Aug,Nov Th[4] 05:00-12:00', '2026-10-01', 160), [
    '2026-11-26',
    '2027-02-25',
  ]);
  assert.deepEqual(days('Mo[-1]', '2026-10-01', 61), ['2026-10-26', '2026-11-30']);
  assert.deepEqual(days('We[2,4]', '2026-12-01', 31), ['2026-12-09', '2026-12-23']);
});

test('a year written once applies to the following months', () => {
  assert.deepEqual(days('2026 Jan,Apr,Jul,Oct Tu[1]', '2026-01-01', 730), [
    '2026-01-06',
    '2026-04-07',
    '2026-07-07',
    '2026-10-06',
  ]);
});

test('a year range followed by months', () => {
  assert.deepEqual(days('2024-2026 Dec: We[2,4] 09:00-19:00', '2026-12-01', 400), [
    '2026-12-09',
    '2026-12-23',
  ]);
});

test('week lists and weekday lists', () => {
  const selected = days('2026,2027 week 1-17,19-52 Mo,We,Fr 14:00-18:00', '2026-04-27', 14);
  // Week 18 of 2026 (Apr 27 - May 3) is excluded.
  assert.deepEqual(selected, ['2026-05-04', '2026-05-06', '2026-05-08']);
  assert.deepEqual(days('Mo-We', '2026-10-05', 7), ['2026-10-05', '2026-10-06', '2026-10-07']);
});

test('a recurring date range across New Year', () => {
  const selected = days('Dec 24-Jan 02', '2026-12-20', 20);
  assert.equal(selected[0], '2026-12-24');
  assert.equal(selected.at(-1), '2027-01-02');
  assert.equal(selected.length, 10);
});

test('a later off rule closes what an earlier rule opened', () => {
  const rules = parseOpeningHours('Tu; 2026 Jul 14 off');
  assert.equal(isOpen(rules, d('2026-07-07')), true);
  assert.equal(isOpen(rules, d('2026-07-14')), false);
});

test('comments are ignored', () => {
  assert.deepEqual(days('Jan 01-Jan 02 off "Fermeture"', '2027-01-01', 5), [
    '2027-01-01',
    '2027-01-02',
  ]);
});

test('unsupported syntax throws instead of guessing', () => {
  assert.throws(() => parseOpeningHours('PH off'), OpeningHoursError);
  assert.throws(() => parseOpeningHours('easter'), OpeningHoursError);
  assert.throws(() => parseOpeningHours(''), OpeningHoursError);
  assert.throws(() => parseOpeningHours('Mo @ 12'), OpeningHoursError);
});
