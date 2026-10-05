import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { dayNumber } from '../src/dates.js';
import { MAX_ITEMS, buildUpcomingWidget, ttlUntilMidnight } from '../src/widget.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const gladys = createFakeGladys();
const today = dayNumber(2026, 10, 5);
const NOW = new Date('2026-10-05T08:00:00Z'); // 10:00 in Paris

const schedule = {
  today,
  types: [
    { key: 'omr', label: 'Ordures ménagères', days: [today, today + 7, today + 14] },
    { key: 'emb', label: 'Emballages (bac jaune)', days: [today + 1, today + 15] },
    { key: 'verre', label: 'Verre', days: [today + 3] },
  ],
};

test('the content is valid for the core, as sent', () => {
  for (const s of [schedule, { today, types: [] }]) {
    const content = buildUpcomingWidget(gladys, s, { language: 'fr', now: NOW });
    assert.deepEqual(validateWidgetContent(content), []);
  }
});

test('rows are sorted by date, with today and tomorrow badges', () => {
  const content = buildUpcomingWidget(gladys, schedule, { language: 'fr', now: NOW });
  const { items } = content.components[0];
  assert.deepEqual(
    items.map((i) => [i.title, i.subtitle, i.badge?.text ?? null]),
    [
      ['Ordures ménagères', "lun. 5 oct. · Aujourd'hui", "Aujourd'hui"],
      ['Emballages (bac jaune)', 'mar. 6 oct. · Demain', 'Demain'],
      ['Verre', 'jeu. 8 oct. · Dans 3 jours', null],
      ['Ordures ménagères', 'lun. 12 oct. · Dans 7 jours', null],
      ['Ordures ménagères', 'lun. 19 oct. · Dans 14 jours', null],
    ],
  );
});

test('settings: number of rows and waste types', () => {
  const content = buildUpcomingWidget(gladys, schedule, {
    settings: { max_items: 2, types: ['ext:test:waste-collection:emb'] },
    language: 'en',
    now: NOW,
  });
  const { items } = content.components[0];
  // The comma after the weekday depends on the ICU version of Node.
  assert.equal(items.length, 2);
  assert.match(items[0].subtitle, /^Tue,? 6 Oct · Tomorrow$/);
  assert.match(items[1].subtitle, /^Tue,? 20 Oct · In 15 days$/);
  const many = buildUpcomingWidget(gladys, schedule, { settings: { max_items: 50 }, now: NOW });
  assert.ok(many.components[0].items.length <= MAX_ITEMS);
});

test('an empty schedule shows a hint', () => {
  const content = buildUpcomingWidget(gladys, { today, types: [] }, { language: 'en', now: NOW });
  assert.equal(content.components[0].type, 'text');
  assert.match(content.components[0].text.en, /No collection/);
});

test('the content expires at the next midnight in Paris, within the core bounds', () => {
  assert.equal(ttlUntilMidnight(new Date('2026-10-05T21:30:00Z')), 1860); // 23:30 → 00:01
  assert.equal(ttlUntilMidnight(NOW), 3600);
  assert.equal(ttlUntilMidnight(new Date('2026-10-05T21:59:30Z')), 90);
});
