import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { toIso } from '../src/dates.js';
import { createScheduleService, nextCollections, upcomingCollections } from '../src/schedule.js';
import { AUBIGNE_ROUTES, mockFetch } from './helpers/mockFetch.js';

// Monday, October 5th, 2026, 10:00 in Paris.
const NOW = new Date('2026-10-05T08:00:00Z');

async function withService(fn, { routes = AUBIGNE_ROUTES, now = () => NOW } = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'waste-'));
  const fetchMock = mockFetch(routes);
  try {
    await fn({ service: createScheduleService({ dataDir, now }), fetchMock, dataDir });
  } finally {
    fetchMock.restore();
    await rm(dataDir, { recursive: true, force: true });
  }
}

const VALCO = { provider: 'valcobreizh', address: '1 rue de la mairie aubigné' };
const firstDays = (schedule, key, n = 3) =>
  schedule.types
    .find((t) => t.key === key)
    .days.slice(0, n)
    .map(toIso);

test('custom schedule: days from today, holiday rule applied', async () => {
  await withService(async ({ service, fetchMock }) => {
    const schedule = await service.getSchedule(
      normalizeConfig({ rule_omr: 'mercredi', rule_emb: 'lundi semaines paires' }),
    );
    assert.equal(fetchMock.calls.length, 0, 'no download without a provider');
    assert.deepEqual(schedule.errors, []);
    assert.deepEqual(
      schedule.types.map((t) => [t.key, t.source]),
      [
        ['omr', 'custom'],
        ['emb', 'custom'],
      ],
    );
    assert.deepEqual(firstDays(schedule, 'omr'), ['2026-10-07', '2026-10-14', '2026-10-21']);
    // Wednesday November 11th is a holiday → Thursday 12th.
    assert.ok(firstDays(schedule, 'omr', 7).includes('2026-11-12'));
    assert.deepEqual(firstDays(schedule, 'emb', 2), ['2026-10-12', '2026-10-26']);
  });
});

test('today counts as an upcoming day', async () => {
  await withService(async ({ service }) => {
    const schedule = await service.getSchedule(normalizeConfig({ rule_omr: 'lundi' }));
    assert.equal(toIso(schedule.types[0].days[0]), '2026-10-05');
    assert.equal(nextCollections(schedule)[0].inDays, 0);
  });
});

test('a holiday shift may bring a day of last week to today', async () => {
  // Wednesday July 15th, 2026: the Tuesday collection of July 14th lands today.
  await withService(
    async ({ service }) => {
      const schedule = await service.getSchedule(normalizeConfig({ rule_omr: 'mardi' }));
      assert.equal(toIso(schedule.types[0].days[0]), '2026-07-15');
    },
    { now: () => new Date('2026-07-15T08:00:00Z') },
  );
});

test('an invalid custom rule is reported, the other types still work', async () => {
  await withService(async ({ service }) => {
    const schedule = await service.getSchedule(
      normalizeConfig({ rule_omr: 'mardi', rule_verre: 'quand il pleut' }),
    );
    assert.deepEqual(
      schedule.types.map((t) => t.key),
      ['omr'],
    );
    assert.equal(schedule.errors.length, 1);
    assert.match(schedule.errors[0].fr, /^Verre — « quand il pleut » : Mot non compris/);
  });
});

test('nothing configured is an error, not a silent empty schedule', async () => {
  await withService(async ({ service }) => {
    const schedule = await service.getSchedule(normalizeConfig({}));
    assert.equal(schedule.types.length, 0);
    assert.match(schedule.errors[0].fr, /Aucun planning/);
  });
});

test('provider: Valcobreizh days for the address, matched address reported', async () => {
  await withService(async ({ service, fetchMock }) => {
    const schedule = await service.getSchedule(normalizeConfig(VALCO));
    assert.deepEqual(schedule.errors, []);
    assert.equal(schedule.address, '1 Rue de la Mairie 35250 Aubigné');
    assert.equal(schedule.provider.key, 'valcobreizh');
    assert.deepEqual(firstDays(schedule, 'omr'), ['2026-10-06', '2026-10-13', '2026-10-20']);
    assert.deepEqual(firstDays(schedule, 'emb'), ['2026-10-12', '2026-10-26', '2026-11-09']);
    assert.equal(schedule.types.find((t) => t.key === 'omr').label, 'Ordures ménagères');
    const search = fetchMock.calls.find((u) => u.pathname === '/v2/search');
    assert.equal(search.searchParams.get('instances[]'), '1003');
  });
});

test('provider data is cached: the polls of every device download once', async () => {
  await withService(async ({ service, fetchMock }) => {
    const config = normalizeConfig(VALCO);
    await Promise.all([
      service.getSchedule(config),
      service.getSchedule(config),
      service.getSchedule(config),
    ]);
    await service.getSchedule(config);
    assert.equal(fetchMock.calls.length, 2, 'one geocoder + one search call');
    await service.getSchedule(config, { force: true });
    assert.equal(fetchMock.calls.length, 4, 'force downloads again');
  });
});

test('the cache expires after 6 hours, and depends on the address', async () => {
  let now = NOW;
  await withService(
    async ({ service, fetchMock }) => {
      await service.getSchedule(normalizeConfig(VALCO));
      now = new Date(NOW.getTime() + 5 * 3600 * 1000);
      await service.getSchedule(normalizeConfig(VALCO));
      assert.equal(fetchMock.calls.length, 2);
      now = new Date(NOW.getTime() + 7 * 3600 * 1000);
      await service.getSchedule(normalizeConfig(VALCO));
      assert.equal(fetchMock.calls.length, 4);
      await service.getSchedule(
        normalizeConfig({ ...VALCO, address: '2 rue de la mairie aubigné' }),
      );
      assert.equal(fetchMock.calls.length, 6);
    },
    { now: () => now },
  );
});

test('a failed download keeps the previous data and retries 15 minutes later', async () => {
  let now = NOW;
  let failing = false;
  const routes = {
    '/v2/geocoder': () => (failing ? new Error('ETIMEDOUT') : AUBIGNE_ROUTES['/v2/geocoder']),
    '/v2/search': AUBIGNE_ROUTES['/v2/search'],
  };
  await withService(
    async ({ service, fetchMock }) => {
      const config = normalizeConfig(VALCO);
      await service.getSchedule(config);
      failing = true;
      now = new Date(NOW.getTime() + 7 * 3600 * 1000);
      const stale = await service.getSchedule(config);
      assert.equal(stale.types.length, 2, 'the previous days are kept');
      assert.match(stale.errors[0].fr, /Publidata injoignable.*Dernières données conservées/);
      const calls = fetchMock.calls.length;
      now = new Date(now.getTime() + 5 * 60 * 1000);
      await service.getSchedule(config);
      assert.equal(fetchMock.calls.length, calls, 'no retry before 15 minutes');
      failing = false;
      now = new Date(now.getTime() + 15 * 60 * 1000);
      const recovered = await service.getSchedule(config);
      assert.deepEqual(recovered.errors, []);
    },
    { routes, now: () => now },
  );
});

test('the provider data survives a restart through /data', async () => {
  await withService(async ({ dataDir }) => {
    const config = normalizeConfig(VALCO);
    await createScheduleService({ dataDir, now: () => NOW }).getSchedule(config);
    const saved = JSON.parse(await readFile(path.join(dataDir, 'publidata-cache.json'), 'utf8'));
    assert.equal(saved.address, '1 Rue de la Mairie 35250 Aubigné');

    // Restart, network down.
    const offline = mockFetch({ '/v2/geocoder': new Error('ENETUNREACH') });
    try {
      const later = () => new Date(NOW.getTime() + 24 * 3600 * 1000);
      const schedule = await createScheduleService({ dataDir, now: later }).getSchedule(config);
      assert.equal(schedule.types.length, 2);
      assert.equal(schedule.errors.length, 1);
    } finally {
      offline.restore();
    }
  });
});

test('provider unknown address: a clear error and no days', async () => {
  await withService(
    async ({ service }) => {
      const schedule = await service.getSchedule(normalizeConfig(VALCO));
      assert.equal(schedule.types.length, 0);
      assert.match(schedule.errors[0].fr, /Adresse introuvable/);
    },
    { routes: { '/v2/geocoder': [{ data: { features: [] } }] } },
  );
});

test('an address spanning several sectors asks for a house number', async () => {
  const search = structuredClone(AUBIGNE_ROUTES['/v2/search']);
  search.hits.hits.push(structuredClone(search.hits.hits[0]));
  await withService(
    async ({ service }) => {
      const schedule = await service.getSchedule(normalizeConfig(VALCO));
      assert.match(
        schedule.errors[0].fr,
        /Plusieurs secteurs.*\(Emballages \(bac jaune\)\).*numéro/,
      );
      assert.equal(schedule.types.length, 2, 'the days are still available');
    },
    { routes: { ...AUBIGNE_ROUTES, '/v2/search': search } },
  );
});

test('generic Publidata needs an instance id', async () => {
  await withService(async ({ service, fetchMock }) => {
    const schedule = await service.getSchedule(
      normalizeConfig({ ...VALCO, provider: 'publidata' }),
    );
    assert.match(schedule.errors[0].fr, /identifiant d'instance/);
    assert.equal(fetchMock.calls.length, 0);
    await service.getSchedule(
      normalizeConfig({ ...VALCO, provider: 'publidata', publidata_instance: '876' }),
    );
    assert.equal(
      fetchMock.calls.find((u) => u.pathname === '/v2/search').searchParams.get('instances[]'),
      '876',
    );
  });
});

test('custom rules complete the provider, never override it', async () => {
  await withService(async ({ service }) => {
    const schedule = await service.getSchedule(
      normalizeConfig({ ...VALCO, rule_omr: 'samedi', rule_verre: '1er jeudi' }),
    );
    assert.deepEqual(
      schedule.types.map((t) => [t.key, t.source]),
      [
        ['omr', 'provider'],
        ['emb', 'provider'],
        ['verre', 'custom'],
      ],
    );
    assert.deepEqual(firstDays(schedule, 'omr', 1), ['2026-10-06']);
    assert.deepEqual(firstDays(schedule, 'verre', 2), ['2026-11-05', '2026-12-03']);
  });
});

test('exceptions move, cancel and add days, on any source', async () => {
  await withService(async ({ service }) => {
    const schedule = await service.getSchedule(
      normalizeConfig({
        ...VALCO,
        exceptions:
          'omr: 06/10/2026 > 07/10/2026 ; -2026-10-12 ; enc: +2026-10-31 ; dv: -2026-10-10',
      }),
    );
    assert.deepEqual(schedule.errors, []);
    assert.deepEqual(firstDays(schedule, 'omr', 2), ['2026-10-07', '2026-10-13']);
    assert.deepEqual(firstDays(schedule, 'emb', 1), ['2026-10-26']);
    assert.deepEqual(firstDays(schedule, 'enc'), ['2026-10-31']);
    assert.equal(
      schedule.types.find((t) => t.key === 'dv'),
      undefined,
      'removing a day does not create a type',
    );
  });
});

test('upcomingCollections lists every day, sorted, optionally filtered', async () => {
  await withService(async ({ service }) => {
    const schedule = await service.getSchedule(normalizeConfig(VALCO));
    const all = upcomingCollections(schedule).slice(0, 4);
    assert.deepEqual(
      all.map((c) => [c.key, toIso(c.day), c.inDays]),
      [
        ['omr', '2026-10-06', 1],
        ['emb', '2026-10-12', 7],
        ['omr', '2026-10-13', 8],
        ['omr', '2026-10-20', 15],
      ],
    );
    assert.ok(upcomingCollections(schedule, ['emb']).every((c) => c.key === 'emb'));
  });
});
