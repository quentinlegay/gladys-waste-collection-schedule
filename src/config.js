// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. The SDK fetches it for you
// (`gladys.getConfig()`) and notifies you of every change through
// `gladys.onConfigUpdated()`.
//
// This module only provides defaults and normalizes the received object, so the
// rest of the code never has to deal with `undefined`.
// -----------------------------------------------------------------------------

import { HOLIDAY_RULES } from './holidays.js';
import { CUSTOM, PROVIDERS } from './providers/index.js';
import { CUSTOM_WASTE_TYPES } from './wasteTypes.js';

// Refresh interval of the sensors, in MILLISECONDS. Gladys only accepts a few
// values for a device `poll_frequency` (DEVICE_POLL_FREQUENCIES of the core:
// 1 s, 2 s, 10 s, 15 s, 30 s, 1 min) and rejects the whole discovery otherwise.
// 1 min is the slowest: the "days until" sensors switch at most one minute
// after midnight. It does not mean one download per minute (see schedule.js).
export const POLL_FREQUENCY = 60_000;

/** Config key of the custom rule of a waste type. */
export const ruleKey = (wasteKey) => `rule_${wasteKey}`;

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest.
export const DEFAULT_CONFIG = {
  provider: CUSTOM,
  address: '',
  insee_code: '',
  publidata_instance: null,
  ...Object.fromEntries(CUSTOM_WASTE_TYPES.map((t) => [ruleKey(t.key), ''])),
  holiday_rule: HOLIDAY_RULES.SHIFT_WEEK,
  exceptions: '',
  language: 'fr',
  // Not in config_schema: fixed, see POLL_FREQUENCY.
  poll_frequency: POLL_FREQUENCY,
};

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const instance = Number.parseInt(String(raw.publidata_instance ?? ''), 10);
  const config = {
    ...DEFAULT_CONFIG,
    provider: Object.hasOwn(PROVIDERS, raw.provider) ? raw.provider : DEFAULT_CONFIG.provider,
    address: text(raw.address),
    insee_code: text(raw.insee_code).replace(/\s/g, ''),
    publidata_instance: Number.isInteger(instance) && instance > 0 ? instance : null,
    holiday_rule: Object.values(HOLIDAY_RULES).includes(raw.holiday_rule)
      ? raw.holiday_rule
      : DEFAULT_CONFIG.holiday_rule,
    exceptions: text(raw.exceptions),
    language: raw.language === 'en' ? 'en' : 'fr',
    poll_frequency: POLL_FREQUENCY,
  };
  for (const type of CUSTOM_WASTE_TYPES) {
    config[ruleKey(type.key)] = text(raw[ruleKey(type.key)]);
  }
  return config;
}
