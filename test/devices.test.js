import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_UNITS } from '@gladysassistant/integration-sdk';
import { POLL_FREQUENCY, normalizeConfig } from '../src/config.js';
import { dayNumber } from '../src/dates.js';
import {
  buildAllStates,
  buildDiscoveredDevices,
  createStatePublisher,
  deviceKey,
} from '../src/devices/index.js';
import { HORIZON_DAYS } from '../src/schedule.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

const gladys = createFakeGladys();
const today = dayNumber(2026, 10, 5);

const schedule = {
  today,
  types: [
    { key: 'omr', label: 'Ordures ménagères', source: 'provider', days: [today + 1, today + 8] },
    {
      key: 'emb',
      label: 'Emballages (bac jaune)',
      source: 'provider',
      days: [today + 1, today + 15],
    },
    { key: 'verre', label: 'Verre', source: 'custom', days: [] },
  ],
  errors: [],
};

test('one summary device plus one device per waste type', () => {
  const devices = buildDiscoveredDevices(gladys, normalizeConfig(), schedule);
  assert.deepEqual(
    devices.map((d) => [d.name, d.external_id]),
    [
      ['Prochaine collecte', 'ext:test:waste-summary:next'],
      ['Collecte Ordures ménagères', 'ext:test:waste-collection:omr'],
      ['Collecte Emballages (bac jaune)', 'ext:test:waste-collection:emb'],
      ['Collecte Verre', 'ext:test:waste-collection:verre'],
    ],
  );
  assert.equal(new Set(devices.map((d) => d.external_id)).size, devices.length);
});

test('devices poll every minute (a value Gladys accepts) with two read-only sensors', () => {
  for (const device of buildDiscoveredDevices(gladys, normalizeConfig(), schedule)) {
    assert.equal(device.poll_frequency, POLL_FREQUENCY);
    assert.equal(POLL_FREQUENCY, 60_000);
    const [days, text] = device.features;
    assert.equal(days.category, DEVICE_FEATURE_CATEGORIES.DURATION);
    assert.equal(days.unit, DEVICE_FEATURE_UNITS.DAYS);
    assert.equal(days.external_id, `${device.external_id}:days_until`);
    assert.equal(text.category, DEVICE_FEATURE_CATEGORIES.TEXT);
    assert.equal(text.external_id, `${device.external_id}:next_date`);
    for (const feature of device.features) {
      assert.equal(feature.read_only, true);
    }
  }
});

test('names follow the configured language', () => {
  const devices = buildDiscoveredDevices(gladys, normalizeConfig({ language: 'en' }), {
    ...schedule,
    types: [{ ...schedule.types[0], label: 'Household waste' }],
  });
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Next collection', 'Collection Household waste'],
  );
  assert.equal(devices[1].features[0].name, 'Days until collection');
});

test('only the summary device without a schedule yet', () => {
  assert.equal(buildDiscoveredDevices(gladys, normalizeConfig(), null).length, 1);
});

test('states: days until the next collection and its date', () => {
  const states = buildAllStates(gladys, normalizeConfig(), schedule);
  const byId = Object.fromEntries(
    states.map((s) => [s.device_feature_external_id, s.text ?? s.state]),
  );
  assert.equal(byId['ext:test:waste-collection:omr:days_until'], 1);
  assert.equal(byId['ext:test:waste-collection:omr:next_date'], 'mardi 6 octobre 2026');
  assert.equal(byId['ext:test:waste-collection:emb:days_until'], 1);
  // Two types on the same next day: both on the summary device.
  assert.equal(byId['ext:test:waste-summary:next:days_until'], 1);
  assert.equal(
    byId['ext:test:waste-summary:next:next_date'],
    'Ordures ménagères, Emballages (bac jaune) — mardi 6 octobre 2026',
  );
  // Nothing scheduled: the maximum, never a stale 0/1.
  assert.equal(byId['ext:test:waste-collection:verre:days_until'], HORIZON_DAYS);
  assert.equal(byId['ext:test:waste-collection:verre:next_date'], 'Aucune collecte prévue');
});

test('the summary device without any collection', () => {
  const states = buildAllStates(gladys, normalizeConfig({ language: 'en' }), { today, types: [] });
  assert.deepEqual(
    states.map((s) => s.text ?? s.state),
    [HORIZON_DAYS, 'No collection scheduled'],
  );
});

test('deviceKey maps an external_id back to its waste type', () => {
  assert.equal(deviceKey(gladys, 'ext:test:waste-collection:omr'), 'omr');
  assert.equal(deviceKey(gladys, 'ext:test:waste-summary:next'), 'next');
  assert.equal(deviceKey(gladys, 'ext:other:thing'), null);
  assert.equal(deviceKey(gladys, undefined), null);
});

test('the state publisher only sends what changed', async () => {
  const fake = createFakeGladys();
  const publisher = createStatePublisher(fake);
  const states = buildAllStates(fake, normalizeConfig(), schedule);
  assert.equal(await publisher.publish(states), states.length);
  assert.equal(await publisher.publish(states), 0);
  const next = buildAllStates(fake, normalizeConfig(), { ...schedule, today: today + 1 });
  // Every counter moved, the dates did not.
  assert.equal(await publisher.publish(next), 3);
  publisher.reset();
  assert.equal(await publisher.publish(next), next.length);
  assert.equal(fake.published.length, states.length + 3 + next.length);
});
