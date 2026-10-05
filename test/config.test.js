import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, POLL_FREQUENCY, normalizeConfig } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig keeps valid user values and trims texts', () => {
  const config = normalizeConfig({
    provider: 'valcobreizh',
    address: '  1 rue de la Mairie 35250 Aubigné ',
    insee_code: '35 007',
    rule_omr: ' mardi ',
    holiday_rule: 'skip',
    language: 'en',
  });
  assert.equal(config.provider, 'valcobreizh');
  assert.equal(config.address, '1 rue de la Mairie 35250 Aubigné');
  assert.equal(config.insee_code, '35007');
  assert.equal(config.rule_omr, 'mardi');
  assert.equal(config.holiday_rule, 'skip');
  assert.equal(config.language, 'en');
});

test('normalizeConfig falls back to the defaults on unknown values', () => {
  const config = normalizeConfig({
    provider: 'nope',
    holiday_rule: 'maybe',
    language: 'de',
    rule_omr: 42,
  });
  assert.equal(config.provider, 'custom');
  assert.equal(config.holiday_rule, 'shift_week');
  assert.equal(config.language, 'fr');
  assert.equal(config.rule_omr, '');
});

test('the Publidata instance id is a positive integer, or null', () => {
  assert.equal(normalizeConfig({ publidata_instance: '1003' }).publidata_instance, 1003);
  assert.equal(normalizeConfig({ publidata_instance: 876 }).publidata_instance, 876);
  assert.equal(normalizeConfig({ publidata_instance: '' }).publidata_instance, null);
  assert.equal(normalizeConfig({ publidata_instance: -4 }).publidata_instance, null);
});

test('the poll frequency is fixed, whatever the config says', () => {
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, POLL_FREQUENCY);
});
