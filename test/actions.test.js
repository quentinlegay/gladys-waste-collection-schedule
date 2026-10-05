import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_PREVIEW,
  ACTION_TEST_RULE,
  createActions,
  describeSchedule,
} from '../src/actions.js';
import { normalizeConfig } from '../src/config.js';
import { dayNumber } from '../src/dates.js';
import { PROVIDERS } from '../src/providers/index.js';

const today = dayNumber(2026, 10, 5);
const actions = createActions({
  async getSchedule(config, options) {
    return {
      today,
      provider: PROVIDERS[config.provider],
      address: config.provider === 'custom' ? null : '1 Rue de la Mairie 35250 Aubigné',
      forced: options?.force,
      types: [
        {
          key: 'omr',
          label: 'Ordures ménagères',
          source: 'provider',
          days: [today + 1, today + 8],
        },
        { key: 'verre', label: 'Verre', source: 'custom', days: [] },
      ],
      errors: [{ fr: 'Problème', en: 'Problem' }],
    };
  },
});

test('preview: source, matched address, next days, problems', async () => {
  const message = await actions[ACTION_PREVIEW](null, {
    config: normalizeConfig({ provider: 'valcobreizh' }),
  });
  assert.equal(
    message.fr,
    [
      'Source : SMICTOM Valcobreizh.',
      'Adresse reconnue : 1 Rue de la Mairie 35250 Aubigné.',
      'Ordures ménagères : mar. 6 oct., mar. 13 oct.',
      'Verre (perso) : aucune collecte prévue.',
      '⚠ Problème',
    ].join('\n'),
  );
  assert.match(message.en, /^Source: SMICTOM Valcobreizh\./);
});

test('describeSchedule without provider does not tag custom types', () => {
  const message = describeSchedule({
    provider: PROVIDERS.custom,
    address: null,
    types: [{ key: 'omr', label: 'Ordures ménagères', source: 'custom', days: [today] }],
    errors: [],
  });
  assert.equal(message.fr, 'Source : Mon propre planning.\nOrdures ménagères : lun. 5 oct.');
});

test('test_rule: next days of a rule, holiday rule applied', async () => {
  const message = await actions[ACTION_TEST_RULE](null, {
    fields: { rule: 'mercredi' },
    config: normalizeConfig(),
    today,
  });
  assert.match(message.fr, /^Règle comprise\. Prochaines collectes : mercredi 7 octobre 2026 ;/);
  // Wednesday November 11th, 2026 is a holiday.
  assert.match(message.fr, /jeudi 12 novembre 2026/);
});

test('test_rule: explains a wrong or empty rule', async () => {
  const wrong = await actions[ACTION_TEST_RULE](null, {
    fields: { rule: 'mardi matin et soir peut-être' },
    config: normalizeConfig(),
    today,
  });
  assert.match(wrong.fr, /^⚠ « mardi matin et soir peut-être » : Mot non compris : « peut-etre »/);
  const empty = await actions[ACTION_TEST_RULE](null, {
    fields: {},
    config: normalizeConfig(),
    today,
  });
  assert.equal(empty.en, 'Type a rule.');
  const never = await actions[ACTION_TEST_RULE](null, {
    fields: { rule: '2020-01-01' },
    config: normalizeConfig(),
    today,
  });
  assert.match(never.en, /no collection in the next 400 days/);
});
