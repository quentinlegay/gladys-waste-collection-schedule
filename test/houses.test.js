import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describeSchedule } from '../src/actions.js';
import { normalizeConfig } from '../src/config.js';
import { toIso } from '../src/dates.js';
import { reverseGeocode } from '../src/providers/ban.js';
import { pickHouse, providerQuery } from '../src/providers/index.js';
import { ProviderError } from '../src/providers/publidata.js';
import { createScheduleService } from '../src/schedule.js';
import { AUBIGNE_ROUTES, mockFetch } from './helpers/mockFetch.js';

const NOW = new Date('2026-10-05T08:00:00Z');

// As returned by gladys.getHouses(): sorted by name.
const MAISON = {
  id: 'h1',
  name: 'Maison',
  selector: 'maison',
  latitude: 48.294456,
  longitude: -1.635047,
};
const CHALET = {
  id: 'h2',
  name: 'Chalet à la mer',
  selector: 'chalet',
  latitude: 47.5,
  longitude: -2.9,
};
const BUREAU = { id: 'h0', name: 'Bureau', selector: 'bureau', latitude: null, longitude: null };

test('reverseGeocode finds the nearest house number with its BAN id', async () => {
  const fetchMock = mockFetch(AUBIGNE_ROUTES);
  try {
    const address = await reverseGeocode(MAISON);
    assert.deepEqual(address, {
      id: '35007_0024_00001',
      label: '1 Rue de la Mairie 35250 Aubigné',
      citycode: '35007',
      distance: 0,
    });
    const url = fetchMock.calls[0];
    assert.equal(url.origin, 'https://data.geopf.fr');
    assert.equal(url.searchParams.get('lat'), '48.294456');
    assert.equal(url.searchParams.get('lon'), '-1.635047');
    assert.equal(url.searchParams.get('index'), 'address');
  } finally {
    fetchMock.restore();
  }
});

test('reverseGeocode explains an empty answer or a network error', async () => {
  let fetchMock = mockFetch({ '/geocodage/reverse': { features: [] } });
  try {
    await assert.rejects(reverseGeocode(MAISON), (err) => {
      assert.ok(err instanceof ProviderError);
      assert.match(err.messages.fr, /Aucune adresse trouvée à la position de la maison/);
      return true;
    });
  } finally {
    fetchMock.restore();
  }
  fetchMock = mockFetch({ '/geocodage/reverse': new Error('ETIMEDOUT') });
  try {
    await assert.rejects(reverseGeocode(MAISON), /unreachable/);
  } finally {
    fetchMock.restore();
  }
});

test('pickHouse: the first located house by default', () => {
  const { house, error } = pickHouse({ house: '' }, [BUREAU, CHALET, MAISON]);
  assert.equal(error, null);
  assert.equal(house, CHALET);
});

test('pickHouse: a house chosen by name or selector, case and accents ignored', () => {
  assert.equal(pickHouse({ house: 'maison' }, [CHALET, MAISON]).house, MAISON);
  assert.equal(pickHouse({ house: '  CHALET A LA MER ' }, [CHALET, MAISON]).house, CHALET);
  assert.equal(pickHouse({ house: 'chalet' }, [CHALET, MAISON]).house, CHALET);
});

test('pickHouse: explicit errors', () => {
  const unknown = pickHouse({ house: 'Garage' }, [CHALET, MAISON]).error;
  assert.equal(
    unknown.fr,
    'Maison « Garage » introuvable dans Gladys (maisons : « Chalet à la mer », « Maison »).',
  );
  assert.match(unknown.en, /\(houses: "Chalet à la mer", "Maison"\)/);
  assert.match(pickHouse({ house: 'Bureau' }, [BUREAU]).error.fr, /n'a pas de position/);
  assert.match(
    pickHouse({ house: '' }, [BUREAU]).error.fr,
    /Aucune maison de Gladys n'a de position/,
  );
  assert.match(pickHouse({ house: '' }, []).error.fr, /Aucune maison/);
});

test('a typed address wins over the houses', () => {
  const query = providerQuery(normalizeConfig({ provider: 'valcobreizh', address: '1 rue X' }), [
    MAISON,
  ]);
  assert.equal(query.house, null);
  assert.equal(query.houseError, null);
  assert.equal(providerQuery(normalizeConfig({ address: '' }), [MAISON]), null, 'custom mode');
});

async function withService(fn, routes = AUBIGNE_ROUTES) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'waste-'));
  const fetchMock = mockFetch(routes);
  try {
    await fn({ service: createScheduleService({ dataDir, now: () => NOW }), fetchMock });
  } finally {
    fetchMock.restore();
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('no address: the house position gives the collection sector', async () => {
  await withService(async ({ service, fetchMock }) => {
    const schedule = await service.getSchedule(normalizeConfig({ provider: 'valcobreizh' }), {
      houses: [CHALET, MAISON].sort((a, b) => a.name.localeCompare(b.name)),
    });
    // "Chalet à la mer" sorts first: the BAN mock answers Aubigné anyway.
    assert.deepEqual(schedule.errors, []);
    assert.equal(schedule.house, 'Chalet à la mer');
    assert.equal(schedule.address, '1 Rue de la Mairie 35250 Aubigné');
    assert.equal(toIso(schedule.types.find((t) => t.key === 'omr').days[0]), '2026-10-06');
    assert.deepEqual(
      fetchMock.calls.map((u) => u.pathname),
      ['/geocodage/reverse', '/v2/search'],
      'no forward geocoding',
    );
    const search = fetchMock.calls[1];
    assert.equal(search.searchParams.get('address_id'), '35007_0024_00001');
  });
});

test('moving the house downloads again; the same house uses the cache', async () => {
  await withService(async ({ service, fetchMock }) => {
    const config = normalizeConfig({ provider: 'valcobreizh', house: 'Maison' });
    await service.getSchedule(config, { houses: [MAISON] });
    await service.getSchedule(config, { houses: [MAISON] });
    assert.equal(fetchMock.calls.length, 2);
    await service.getSchedule(config, { houses: [{ ...MAISON, latitude: 48.3 }] });
    assert.equal(fetchMock.calls.length, 4);
  });
});

test('a house problem blocks the provider with its own message', async () => {
  await withService(async ({ service, fetchMock }) => {
    const schedule = await service.getSchedule(
      normalizeConfig({ provider: 'valcobreizh', house: 'Garage' }),
      { houses: [MAISON] },
    );
    assert.equal(fetchMock.calls.length, 0);
    assert.equal(schedule.types.length, 0);
    assert.match(schedule.errors[0].fr, /Maison « Garage » introuvable/);
  });
});

test('the preview names the house used, the other houses, a far address', async () => {
  await withService(async ({ service }) => {
    const schedule = await service.getSchedule(normalizeConfig({ provider: 'valcobreizh' }), {
      houses: [MAISON, CHALET],
    });
    const message = describeSchedule(schedule).fr;
    assert.match(message, /Maison utilisée : « Maison »\./);
    assert.match(message, /Adresse reconnue : 1 Rue de la Mairie 35250 Aubigné\./);
    assert.match(message, /Autres maisons : « Chalet à la mer » \(champ « Maison »/);
    assert.match(describeSchedule(schedule).en, /Other houses: "Chalet à la mer" \("House" field/);
    assert.doesNotMatch(message, /⚠/);
    const far = describeSchedule({ ...schedule, distance: 400 }).fr;
    assert.match(far, /⚠ Cette adresse est à 400 m de la position de la maison/);
  });
});
