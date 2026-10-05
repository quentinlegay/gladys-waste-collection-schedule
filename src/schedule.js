// -----------------------------------------------------------------------------
// The collection schedule: one list of upcoming days per waste type.
//
// Sources, merged in this order:
//   1. the provider chosen in the config (Publidata…), when there is one;
//   2. the custom rules (`rule_<type>`): they describe the whole schedule in
//      "my own schedule" mode, and COMPLETE a provider for the types it does
//      not return (e.g. a glass collection organized by the town hall);
//      the holiday rule only applies to them, providers already publish the
//      shifted days;
//   3. the manual exceptions, applied last, to every type.
//
// Downloads are cached 6 h (retried 15 min after a failure, the previous data
// being kept meanwhile) and saved under /data, so a restart without network
// still has a schedule. The days themselves are recomputed on demand: it is
// cheap, and "today" moves.
// -----------------------------------------------------------------------------

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { ruleKey } from './config.js';
import { CustomRuleError, parseCustomRule, parseExceptions } from './customRules.js';
import { today as todayInParis } from './dates.js';
import { applyHolidayRule } from './holidays.js';
import { ProviderError, download, findProvider, providerQuery } from './providers/index.js';
import { compileServices } from './providers/publidata.js';
import { CUSTOM_WASTE_TYPES, WASTE_TYPES, wasteLabel } from './wasteTypes.js';

const logger = createLogger({ name: 'schedule' });

// How far ahead the days are computed.
export const HORIZON_DAYS = 400;
const CACHE_TTL_MS = 6 * 3600 * 1000;
const RETRY_AFTER_MS = 15 * 60 * 1000;
const CACHE_FILE = 'publidata-cache.json';

/**
 * @typedef {object} Schedule
 * @property {number} today day number the schedule was computed for
 * @property {{ key: string, label: string, days: number[], source: 'provider'|'custom' }[]} types
 *   upcoming days (>= today), sorted, per waste type
 * @property {string|null} address address matched by the provider
 * @property {{ fr: string, en: string }[]} errors blocking problems to show the user
 * @property {string[]} warnings non-blocking problems (logged)
 * @property {number|null} fetchedAt when the provider data was downloaded
 */

const message = (err) =>
  err instanceof ProviderError || err instanceof CustomRuleError
    ? err.messages
    : { fr: err.message, en: err.message };

/**
 * @param {{ dataDir?: string, now?: () => Date }} [options]
 */
export function createScheduleService({
  dataDir = process.env.DATA_DIR ?? '/data',
  now = () => new Date(),
} = {}) {
  // Provider data: { id, fetchedAt, address, services, compiled }
  let cached = null;
  let lastFailure = null; // { id, at, error }
  let diskLoaded = false;
  let inflight = null; // { id, promise } of the running download
  // Memo of the last computed schedule.
  let memo = null;

  const queryId = (query) =>
    JSON.stringify([query.provider.key, query.instanceId, query.address, query.inseeCode]);

  async function loadDisk() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const saved = JSON.parse(await readFile(path.join(dataDir, CACHE_FILE), 'utf8'));
      if (saved?.id && Array.isArray(saved.services)) {
        cached = { ...saved, compiled: null };
        logger.info(
          `Loaded the cached provider data of ${new Date(saved.fetchedAt).toISOString()}`,
        );
      }
    } catch (err) {
      if (err.code !== 'ENOENT') logger.debug('No usable cache on disk', err.message);
    }
  }

  async function saveDisk(entry) {
    try {
      await mkdir(dataDir, { recursive: true });
      const { compiled: _compiled, ...data } = entry;
      await writeFile(path.join(dataDir, CACHE_FILE), JSON.stringify(data));
    } catch (err) {
      logger.debug('Cannot save the cache on disk', err.message);
    }
  }

  /**
   * Provider data for a config: cached, downloaded when stale.
   * @returns {Promise<{ data: object|null, error: object|null }>}
   */
  async function providerData(query, force) {
    await loadDisk();
    const id = queryId(query);
    const at = now().getTime();
    const usable = cached?.id === id ? cached : null;
    const fresh = usable && at - usable.fetchedAt < CACHE_TTL_MS;
    const recentFailure =
      lastFailure?.id === id && at - lastFailure.at < RETRY_AFTER_MS ? lastFailure : null;
    if (!force && (fresh || recentFailure)) {
      return { data: usable, error: fresh ? null : recentFailure.error };
    }
    // Every device polls at the same minute: one download for all of them.
    if (inflight?.id === id) {
      return inflight.promise;
    }
    const promise = downloadNow(query, id, at, usable);
    inflight = { id, promise };
    try {
      return await promise;
    } finally {
      if (inflight?.promise === promise) inflight = null;
    }
  }

  async function downloadNow(query, id, at, usable) {
    try {
      const { address, services } = await download(query);
      cached = { id, fetchedAt: at, address, services, compiled: null };
      lastFailure = null;
      logger.info(`Downloaded ${services.length} collection services for "${address}"`);
      await saveDisk(cached);
      return { data: cached, error: null };
    } catch (err) {
      logger.error('Provider download failed', err.message);
      lastFailure = { id, at, error: err };
      return { data: usable, error: err };
    }
  }

  /**
   * Compute the schedule of a config.
   * @param {ReturnType<import('./config.js').normalizeConfig>} config
   * @param {{ force?: boolean }} [options] force: download the provider again
   * @returns {Promise<Schedule>}
   */
  async function getSchedule(config, { force = false } = {}) {
    const today = todayInParis(now());
    const errors = [];
    const warnings = [];
    const query = providerQuery(config);

    let data = null;
    if (query) {
      const result = await providerData(query, force);
      data = result.data;
      if (result.error) {
        const m = message(result.error);
        errors.push(
          data
            ? {
                fr: `${m.fr} Dernières données conservées (${new Date(data.fetchedAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}).`,
                en: `${m.en} Keeping the last data (${new Date(data.fetchedAt).toISOString()}).`,
              }
            : m,
        );
      }
    }

    const memoKey = JSON.stringify([today, config, data?.fetchedAt ?? null, errors]);
    if (memo?.key === memoKey) {
      return memo.schedule;
    }

    const days = new Map(); // key -> { label, source, set }
    const end = today + HORIZON_DAYS;

    // 1. Provider.
    if (data) {
      data.compiled ??= compileServices(data.services);
      warnings.push(...data.compiled.warnings);
      if (data.compiled.ambiguous.length) {
        const names = (l) => data.compiled.ambiguous.map((key) => wasteLabel(key, l)).join(', ');
        errors.push({
          fr: `Plusieurs secteurs de collecte correspondent à « ${data.address} » (${names('fr')}) : leurs jours sont cumulés. Ajoutez le numéro de rue à l'adresse.`,
          en: `Several collection sectors match "${data.address}" (${names('en')}): their days are merged. Add the house number to the address.`,
        });
      }
      for (const [key, { label, match }] of data.compiled.types) {
        const set = new Set();
        for (let dn = today; dn <= end; dn += 1) {
          if (match(dn)) set.add(dn);
        }
        days.set(key, { label, source: 'provider', set });
      }
    }

    // 2. Custom rules (whole schedule, or complement of the provider).
    for (const type of CUSTOM_WASTE_TYPES) {
      const text = config[ruleKey(type.key)];
      if (!text || days.has(type.key)) continue;
      try {
        const match = parseCustomRule(text);
        const set = new Set();
        // A week back: a holiday may push a past day to today.
        for (let dn = today - 7; dn <= end; dn += 1) {
          if (!match(dn)) continue;
          const actual = applyHolidayRule(dn, config.holiday_rule);
          if (actual !== null && actual >= today) set.add(actual);
        }
        days.set(type.key, { label: null, source: 'custom', set });
      } catch (err) {
        const m = message(err);
        const label = { fr: wasteLabel(type.key, 'fr'), en: wasteLabel(type.key, 'en') };
        errors.push({ fr: `${label.fr} — ${m.fr}`, en: `${label.en} — ${m.en}` });
      }
    }

    // 3. Manual exceptions.
    try {
      for (const exception of parseExceptions(config.exceptions)) {
        const targets = exception.type ? [exception.type] : [...days.keys()];
        for (const key of targets) {
          if (!days.has(key)) {
            // An added day may create a type ("verre: +2026-12-31").
            if (exception.add === null) continue;
            days.set(key, { label: null, source: 'custom', set: new Set() });
          }
          const { set } = days.get(key);
          if (exception.remove !== null) set.delete(exception.remove);
          if (exception.add !== null && exception.add >= today) set.add(exception.add);
        }
      }
    } catch (err) {
      errors.push(message(err));
    }

    if (!query && days.size === 0 && errors.length === 0) {
      errors.push({
        fr: 'Aucun planning : renseignez au moins un jour de collecte, ou choisissez un fournisseur.',
        en: 'No schedule: fill in at least one collection day, or choose a provider.',
      });
    }

    const order = (key) => {
      const index = WASTE_TYPES.findIndex((t) => t.key === key);
      return index === -1 ? WASTE_TYPES.length : index;
    };
    const types = [...days.entries()]
      .map(([key, { label, source, set }]) => ({
        key,
        label: wasteLabel(key, config.language, label),
        source,
        days: [...set].sort((a, b) => a - b),
      }))
      .sort((a, b) => order(a.key) - order(b.key) || a.key.localeCompare(b.key));

    const schedule = {
      today,
      types,
      address: data?.address ?? null,
      provider: findProvider(config.provider),
      errors,
      warnings,
      fetchedAt: data?.fetchedAt ?? null,
    };
    memo = { key: memoKey, schedule };
    return schedule;
  }

  return { getSchedule };
}

/**
 * Next collection of every type, sorted by date.
 * @param {Schedule} schedule
 * @returns {{ key: string, label: string, day: number, inDays: number }[]}
 */
export function nextCollections(schedule) {
  return schedule.types
    .filter((t) => t.days.length)
    .map((t) => ({
      key: t.key,
      label: t.label,
      day: t.days[0],
      inDays: t.days[0] - schedule.today,
    }))
    .sort((a, b) => a.day - b.day);
}

/**
 * Every upcoming collection (one entry per type and day), sorted by date.
 * @param {Schedule} schedule
 * @param {string[]|null} [keys] only these types
 */
export function upcomingCollections(schedule, keys = null) {
  return schedule.types
    .filter((t) => !keys || keys.includes(t.key))
    .flatMap((t) =>
      t.days.map((day) => ({ key: t.key, label: t.label, day, inDays: day - schedule.today })),
    )
    .sort((a, b) => a.day - b.day || a.label.localeCompare(b.label));
}
