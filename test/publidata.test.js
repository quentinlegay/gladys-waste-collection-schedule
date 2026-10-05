import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomRule } from '../src/customRules.js';
import { dayNumber, toIso } from '../src/dates.js';
import { HOLIDAY_RULES, applyHolidayRule } from '../src/holidays.js';
import {
  ProviderError,
  compileServices,
  fetchServices,
  geocode,
  serviceLabel,
} from '../src/providers/publidata.js';
import { AUBIGNE_ROUTES, mockFetch } from './helpers/mockFetch.js';

const d = (iso) => dayNumber(...iso.split('-').map(Number));

async function aubigneServices() {
  const fetchMock = mockFetch(AUBIGNE_ROUTES);
  try {
    return await fetchServices({ instanceId: 1003, addressId: '35007_0024_00001' });
  } finally {
    fetchMock.restore();
  }
}

function matchedDays(match, from, to) {
  const out = [];
  for (let dn = d(from); dn <= d(to); dn += 1) {
    if (match(dn)) out.push(toIso(dn));
  }
  return out;
}

test('geocode resolves the address id and sends the query parameters', async () => {
  const fetchMock = mockFetch(AUBIGNE_ROUTES);
  try {
    const address = await geocode({ address: '1 rue de la mairie', inseeCode: '35007' });
    assert.deepEqual(address, {
      id: '35007_0024_00001',
      label: '1 Rue de la Mairie 35250 Aubigné',
      citycode: '35007',
    });
    const url = fetchMock.calls[0];
    assert.equal(url.origin, 'https://api.publidata.io');
    assert.equal(url.searchParams.get('q'), '1 rue de la mairie');
    assert.equal(url.searchParams.get('citycode'), '35007');
    assert.equal(url.searchParams.get('lookup'), 'publidata');
  } finally {
    fetchMock.restore();
  }
});

test('geocode explains a missing or unknown address', async () => {
  await assert.rejects(geocode({ address: '' }), ProviderError);
  const fetchMock = mockFetch({ '/v2/geocoder': [{ data: { features: [] } }] });
  try {
    await assert.rejects(geocode({ address: 'nowhere' }), (err) => {
      assert.ok(err instanceof ProviderError);
      assert.match(err.messages.fr, /Adresse introuvable/);
      return true;
    });
  } finally {
    fetchMock.restore();
  }
});

test('network and HTTP errors become ProviderErrors', async () => {
  let fetchMock = mockFetch({ '/v2/search': new Error('ECONNREFUSED') });
  try {
    await assert.rejects(fetchServices({ instanceId: 1003, addressId: 'x' }), /unreachable/);
  } finally {
    fetchMock.restore();
  }
  fetchMock = mockFetch({});
  try {
    await assert.rejects(fetchServices({ instanceId: 1003, addressId: 'x' }), /HTTP 404/);
  } finally {
    fetchMock.restore();
  }
});

test('fetchServices keeps the services of the address sector only', async () => {
  const fetchMock = mockFetch(AUBIGNE_ROUTES);
  try {
    const services = await fetchServices({ instanceId: 1003, addressId: '35007_0024_00001' });
    assert.deepEqual(
      services.map((s) => s.code),
      ['emb', 'omr'],
    );
    const url = fetchMock.calls[0];
    assert.equal(url.searchParams.get('instances[]'), '1003');
    assert.equal(url.searchParams.get('address_id'), '35007_0024_00001');
    assert.equal(url.searchParams.get('types[]'), 'Platform::Services::WasteCollection');
  } finally {
    fetchMock.restore();
  }
});

test('serviceLabel extracts a readable name', () => {
  assert.equal(serviceLabel('Collecte du verre - Porte-à-porte - X'), 'Verre');
  assert.equal(serviceLabel('Collecte des ordures ménagères - Porte-à-porte'), 'Ordures ménagères');
  assert.equal(serviceLabel(''), '');
});

test('Aubigné: household waste every Tuesday, shifted after public holidays', async () => {
  const { types, warnings } = compileServices(await aubigneServices());
  assert.deepEqual(warnings, []);
  const omr = types.get('omr').match;
  assert.deepEqual(matchedDays(omr, '2026-10-01', '2026-10-31'), [
    '2026-10-06',
    '2026-10-13',
    '2026-10-20',
    '2026-10-27',
  ]);
  // Whit Monday 2026 → Wednesday May 27th; July 14th (a Tuesday) → 15th.
  assert.equal(omr(d('2026-05-26')), false);
  assert.equal(omr(d('2026-05-27')), true);
  assert.equal(omr(d('2026-07-14')), false);
  assert.equal(omr(d('2026-07-15')), true);
  // The 2026 weekly rule "ends" on 2026-12-31 but stays the latest one: 2027
  // is still collected.
  assert.equal(omr(d('2027-01-05')), true);
  assert.equal(omr(d('2027-11-02')), false);
  assert.equal(omr(d('2027-11-03')), true);
});

test('Aubigné: packaging on Monday of even weeks, the 2023 rule is over', async () => {
  const { types } = compileServices(await aubigneServices());
  const emb = types.get('emb').match;
  assert.deepEqual(matchedDays(emb, '2026-10-01', '2026-10-31'), ['2026-10-12', '2026-10-26']);
  // Not the old "Tuesday of odd weeks" rule (2023 - March 2024).
  assert.equal(emb(d('2026-10-06')), false);
  assert.equal(emb(d('2026-05-25')), false);
  assert.equal(emb(d('2026-05-26')), true);
});

test('the provider and an equivalent custom schedule agree, public holidays included', async () => {
  // The point of the custom schedule: "mardi" + the usual holiday rule must
  // give what the provider publishes (here until the end of 2027).
  const { types } = compileServices(await aubigneServices());
  const custom = (rule) => {
    const match = parseCustomRule(rule);
    const set = new Set();
    for (let dn = d('2026-09-24'); dn <= d('2027-12-31'); dn += 1) {
      if (match(dn)) set.add(applyHolidayRule(dn, HOLIDAY_RULES.SHIFT_WEEK));
    }
    return (dn) => set.has(dn);
  };
  for (const [key, rule] of [
    ['omr', 'mardi'],
    ['emb', 'lundi semaines paires'],
  ]) {
    assert.deepEqual(
      matchedDays(custom(rule), '2026-10-01', '2027-12-31'),
      matchedDays(types.get(key).match, '2026-10-01', '2027-12-31'),
      key,
    );
  }
});

test('an unsupported schedule is skipped with a warning, never guessed', () => {
  const { types, warnings } = compileServices([
    {
      code: 'verre',
      name: 'Collecte du verre',
      schedules: [
        { type: 'regular', openingHours: 'We', startAt: null, endAt: null },
        { type: 'closing_exception', openingHours: 'PH off', startAt: null, endAt: null },
      ],
    },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^verre: unsupported "PH"/);
  assert.equal(types.get('verre').match(d('2026-10-07')), true);
});

test('an older regular rule stops at its end, the newest one goes on', () => {
  const { types } = compileServices([
    {
      code: 'omr',
      name: '',
      schedules: [
        {
          type: 'regular',
          openingHours: 'Tu',
          startAt: '2026-01-01T00:00:00.000+00:00',
          endAt: '2026-12-31T00:00:00.000+00:00',
        },
        {
          type: 'regular',
          openingHours: 'We',
          startAt: '2027-01-01T00:00:00.000+00:00',
          endAt: '2027-12-31T00:00:00.000+00:00',
        },
      ],
    },
  ]);
  const omr = types.get('omr').match;
  assert.deepEqual(matchedDays(omr, '2026-12-28', '2027-01-10'), ['2026-12-29', '2027-01-06']);
  assert.equal(omr(d('2028-03-01')), true); // Wednesday, after the last end
});

test('two sectors for one type at an address are flagged as ambiguous', async () => {
  const services = await aubigneServices();
  assert.deepEqual(compileServices(services).ambiguous, []);
  const { ambiguous } = compileServices([...services, { ...services[1], name: 'Autre secteur' }]);
  assert.deepEqual(ambiguous, ['omr']);
});

test('unknown provider codes keep their own key and label', () => {
  const { types } = compileServices([
    {
      code: 'carton',
      name: 'Collecte des cartons - X',
      schedules: [{ type: 'regular', openingHours: 'Fr' }],
    },
  ]);
  assert.deepEqual([...types.keys()], ['carton']);
  assert.equal(types.get('carton').label, 'Cartons');
});
