import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayNumber, parisMinute } from '../src/dates.js';
import {
  ALL_TYPES,
  MOMENTS,
  TRIGGER_COLLECTION_REMINDER,
  createReminderWatcher,
  findDueReminders,
} from '../src/scenes.js';

const today = dayNumber(2026, 10, 5); // Monday
const schedule = {
  today,
  types: [
    { key: 'omr', label: 'Ordures ménagères', days: [today + 1, today + 8] },
    { key: 'emb', label: 'Emballages (bac jaune)', days: [today + 1, today + 7] },
    { key: 'verre', label: 'Verre', days: [today + 3] },
  ],
};
// Paris wall clock of Monday October 5th, 2026.
const at = (hour, minute = 0) => today * 1440 + hour * 60 + minute;

test('parisMinute reads the Paris wall clock', () => {
  assert.equal(parisMinute(new Date('2026-10-05T17:00:00Z')), at(19));
  // Winter time: UTC+1.
  assert.equal(
    parisMinute(new Date('2026-12-01T18:30:00Z')),
    dayNumber(2026, 12, 1) * 1440 + 19 * 60 + 30,
  );
});

test('the day before at 19:00: one event per type plus one for all', () => {
  const events = findDueReminders(schedule, at(18, 59), at(19, 0));
  assert.deepEqual(events, [
    {
      moment: 'eve_19',
      date: 'mardi 6 octobre 2026',
      days_before: 1,
      waste_type: 'omr',
      waste_label: 'Ordures ménagères',
    },
    {
      moment: 'eve_19',
      date: 'mardi 6 octobre 2026',
      days_before: 1,
      waste_type: 'emb',
      waste_label: 'Emballages (bac jaune)',
    },
    {
      moment: 'eve_19',
      date: 'mardi 6 octobre 2026',
      days_before: 1,
      waste_type: ALL_TYPES,
      waste_label: 'Ordures ménagères et Emballages (bac jaune)',
    },
  ]);
});

test('the same day at 06:00', () => {
  const tuesday = today + 1;
  const events = findDueReminders(schedule, tuesday * 1440 + 5 * 60 + 59, tuesday * 1440 + 6 * 60);
  assert.deepEqual(
    events.map((e) => [e.moment, e.waste_type, e.days_before]),
    [
      ['day_06', 'omr', 0],
      ['day_06', 'emb', 0],
      ['day_06', 'all', 0],
    ],
  );
});

test('nothing outside the moments, nothing for a day without collection', () => {
  assert.deepEqual(findDueReminders(schedule, at(19, 0), at(19, 1)), []);
  assert.deepEqual(findDueReminders(schedule, at(10, 0), at(16, 59)), []);
  // Tuesday 19:00 announces Wednesday: nothing collected.
  const tuesday = today + 1;
  assert.deepEqual(
    findDueReminders(schedule, tuesday * 1440 + 18 * 60, tuesday * 1440 + 19 * 60),
    [],
  );
});

test('a window spanning several moments fires each one once', () => {
  const events = findDueReminders(schedule, at(16, 0), at(23, 0));
  const moments = [...new Set(events.map((e) => e.moment))];
  assert.deepEqual(moments, ['eve_17', 'eve_18', 'eve_19', 'eve_20', 'eve_21', 'eve_22']);
  assert.equal(events.length, 6 * 3);
});

test('a single type of the day: the "all" event names it alone', () => {
  // Wednesday 19:00 → Thursday: glass only.
  const wednesday = today + 2;
  const events = findDueReminders(schedule, wednesday * 1440 + 18 * 60, wednesday * 1440 + 19 * 60);
  assert.deepEqual(
    events.map((e) => [e.waste_type, e.waste_label]),
    [
      ['verre', 'Verre'],
      ['all', 'Verre'],
    ],
  );
});

test('labels in English', () => {
  const events = findDueReminders(schedule, at(18, 59), at(19, 0), 'en');
  assert.match(events[0].date, /Tuesday.*6 October 2026/);
  assert.equal(events[2].waste_label, 'Ordures ménagères and Emballages (bac jaune)');
});

test('moment keys are unique and well formed', () => {
  const keys = MOMENTS.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const m of MOMENTS) {
    assert.match(m.key, /^(eve|day)_\d{2}$/);
  }
});

function fakeGladys() {
  const events = [];
  return {
    events,
    async publishSceneEvent(key, data) {
      if (data.waste_type === 'emb') throw new Error('429');
      events.push({ key, data });
    },
  };
}

test('the watcher never replays the past on start, then fires due reminders once', async () => {
  const gladys = fakeGladys();
  const watcher = createReminderWatcher(gladys, {
    getSchedule: async () => schedule,
    getLanguage: () => 'fr',
  });
  // Start at 19:30: the 19:00 reminder is NOT sent (restart case).
  assert.deepEqual(await watcher.check(new Date('2026-10-05T17:30:00Z')), []);
  // 20:00: the 20:00 reminder.
  const fired = await watcher.check(new Date('2026-10-05T18:00:00Z'));
  assert.deepEqual([...new Set(fired.map((e) => e.moment))], ['eve_20']);
  // The refused "emb" event did not stop the others.
  assert.deepEqual(
    gladys.events.map((e) => [e.key, e.data.waste_type]),
    [
      [TRIGGER_COLLECTION_REMINDER, 'omr'],
      [TRIGGER_COLLECTION_REMINDER, 'all'],
    ],
  );
  // Same minute again: nothing.
  assert.deepEqual(await watcher.check(new Date('2026-10-05T18:00:30Z')), []);
});

test('after a pause, reminders up to 30 minutes late are still sent', async () => {
  const gladys = fakeGladys();
  const watcher = createReminderWatcher(gladys, {
    getSchedule: async () => schedule,
    getLanguage: () => 'fr',
  });
  await watcher.check(new Date('2026-10-05T16:00:00Z')); // 18:00
  // Back at 19:20 after a disconnection: 19:00 is 20 minutes late, still sent;
  // 18:00 is older than 30 minutes, dropped.
  const fired = await watcher.check(new Date('2026-10-05T17:20:00Z'));
  assert.deepEqual([...new Set(fired.map((e) => e.moment))], ['eve_19']);
  // Back at 21:45 after a long pause: 21:00 is 45 minutes old, dropped.
  assert.deepEqual(await watcher.check(new Date('2026-10-05T19:45:00Z')), []);
});
