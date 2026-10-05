// -----------------------------------------------------------------------------
// Manifest actions (buttons of the Configuration screen). Each handler
// resolves the multi-language message displayed under the button.
// -----------------------------------------------------------------------------

import { CustomRuleError, parseCustomRule } from './customRules.js';
import { formatLong, formatShort } from './dates.js';
import { applyHolidayRule } from './holidays.js';

export const ACTION_PREVIEW = 'preview_schedule';
export const ACTION_TEST_RULE = 'test_rule';

const SHOWN_DAYS = 3;

/**
 * Message describing a schedule: source, matched address, next days per type,
 * problems.
 * @param {import('./schedule.js').Schedule} schedule
 */
export function describeSchedule(schedule) {
  const out = { fr: [], en: [] };
  const push = (fr, en) => {
    out.fr.push(fr);
    out.en.push(en);
  };
  push(`Source : ${schedule.provider.name.fr}.`, `Source: ${schedule.provider.name.en}.`);
  if (schedule.address) {
    push(`Adresse reconnue : ${schedule.address}.`, `Matched address: ${schedule.address}.`);
  }
  for (const type of schedule.types) {
    const tag = type.source === 'custom' && schedule.provider.platform ? ' (perso)' : '';
    const tagEn = type.source === 'custom' && schedule.provider.platform ? ' (custom)' : '';
    if (!type.days.length) {
      push(
        `${type.label}${tag} : aucune collecte prévue.`,
        `${type.label}${tagEn}: none scheduled.`,
      );
      continue;
    }
    const days = type.days.slice(0, SHOWN_DAYS);
    push(
      `${type.label}${tag} : ${days.map((d) => formatShort(d, 'fr')).join(', ')}`,
      `${type.label}${tagEn}: ${days.map((d) => formatShort(d, 'en')).join(', ')}`,
    );
  }
  if (!schedule.types.length && !schedule.errors.length) {
    push('Aucune collecte trouvée.', 'No collection found.');
  }
  for (const error of schedule.errors) {
    push(`⚠ ${error.fr}`, `⚠ ${error.en}`);
  }
  return { fr: out.fr.join('\n'), en: out.en.join('\n') };
}

/**
 * @param {{ getSchedule: Function }} service see schedule.js
 */
export function createActions(service) {
  return {
    // Download the provider again (bypassing the cache) and show the result.
    async [ACTION_PREVIEW](_gladys, { config }) {
      return describeSchedule(await service.getSchedule(config, { force: true }));
    },

    // Try a rule typed in the action form, without saving anything.
    async [ACTION_TEST_RULE](_gladys, { fields, config, today }) {
      let match;
      try {
        match = parseCustomRule(fields.rule);
      } catch (err) {
        if (err instanceof CustomRuleError) {
          return { fr: `⚠ ${err.messages.fr}`, en: `⚠ ${err.messages.en}` };
        }
        throw err;
      }
      if (!match) {
        return { fr: 'Saisissez une règle.', en: 'Type a rule.' };
      }
      const days = [];
      for (let dn = today - 7; dn <= today + 400 && days.length < 6; dn += 1) {
        if (!match(dn)) continue;
        const actual = applyHolidayRule(dn, config.holiday_rule);
        if (actual !== null && actual >= today) days.push(actual);
      }
      if (!days.length) {
        return {
          fr: 'Règle comprise, mais aucune collecte dans les 400 prochains jours.',
          en: 'Rule understood, but no collection in the next 400 days.',
        };
      }
      return {
        fr: `Règle comprise. Prochaines collectes : ${days.map((d) => formatLong(d, 'fr')).join(' ; ')}.`,
        en: `Rule understood. Next collections: ${days.map((d) => formatLong(d, 'en')).join('; ')}.`,
      };
    },
  };
}
