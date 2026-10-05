// -----------------------------------------------------------------------------
// Publidata provider.
//
// Publidata (https://www.publidata.io) runs the "info déchets" widgets and
// mobile apps of many French collection services, among them SMICTOM
// Valcobreizh ("Valcobreizh et moi", instance 1003), which collects every
// commune of the Val d'Ille-Aubigné. Its public API is the one the widget calls:
//
//   1. GET /v2/geocoder?q=<address>&citycode=<insee>&lookup=publidata
//      → the address id (BAN id, e.g. 35007_0024_00001);
//   2. GET /v2/search?types[]=Platform::Services::WasteCollection
//        &instances[]=<instance>&address_id=<id>
//      → the collection services of the address's SECTOR (sectorization
//        "single"), each with its `schedules` in the OSM `opening_hours`
//        syntax: the regular rule, plus one "closing_exception" /
//        "exception" pair per public holiday (the shifted day). That is
//        what makes a provider more reliable than a custom schedule.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { parseDate } from '../dates.js';
import { OpeningHoursError, isOpen, isSelected, parseOpeningHours } from '../openingHours.js';
import { wasteKey } from '../wasteTypes.js';

const logger = createLogger({ name: 'publidata' });

export const API_URL = 'https://api.publidata.io';
const TIMEOUT_MS = 15_000;

export class ProviderError extends Error {
  /** @param {{ fr: string, en: string }} message */
  constructor(message) {
    super(message.en);
    this.messages = message;
  }
}

async function getJson(path, params) {
  const url = new URL(path, API_URL);
  for (const [key, value] of params) {
    url.searchParams.append(key, String(value));
  }
  logger.debug('GET', url.href);
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    throw new ProviderError({
      fr: `Publidata injoignable (${err.message}).`,
      en: `Publidata unreachable (${err.message}).`,
    });
  }
  if (!response.ok) {
    throw new ProviderError({
      fr: `Publidata a répondu HTTP ${response.status}.`,
      en: `Publidata answered HTTP ${response.status}.`,
    });
  }
  return response.json();
}

/**
 * Resolve a postal address into the Publidata address id.
 * @param {{ address: string, inseeCode?: string }} query
 * @returns {Promise<{ id: string, label: string, citycode: string }>}
 */
export async function geocode({ address, inseeCode }) {
  if (!address) {
    throw new ProviderError({
      fr: 'Renseignez votre adresse dans la configuration.',
      en: 'Fill in your address in the configuration.',
    });
  }
  const params = [
    ['q', address],
    ['limit', 5],
    ['lookup', 'publidata'],
  ];
  if (inseeCode) {
    params.push(['citycode', inseeCode]);
  }
  const body = await getJson('/v2/geocoder', params);
  const features = (Array.isArray(body) ? body : [body]).flatMap((r) => r?.data?.features ?? []);
  // A street without number has an id but covers several sectors: prefer a
  // house number, the widget does the same.
  const best =
    features.find((f) => f.properties?.type === 'housenumber') ??
    features.find((f) => f.properties?.id);
  if (!best) {
    throw new ProviderError({
      fr: `Adresse introuvable : « ${address} ». Indiquez le numéro, la rue, le code postal et la commune.`,
      en: `Address not found: "${address}". Give the number, street, postcode and town.`,
    });
  }
  return {
    id: best.properties.id,
    label: best.properties.label,
    citycode: best.properties.citycode,
  };
}

/**
 * Raw door-to-door collection services of an address.
 * @returns {Promise<{ code: string, name: string, schedules: object[] }[]>}
 */
export async function fetchServices({ instanceId, addressId }) {
  const body = await getJson('/v2/search', [
    ['size', 999],
    ['types[]', 'Platform::Services::WasteCollection'],
    ['instances[]', instanceId],
    ['address_id', addressId],
  ]);
  const hits = body?.hits?.hits;
  if (!Array.isArray(hits)) {
    throw new ProviderError({
      fr: 'Réponse inattendue de Publidata.',
      en: 'Unexpected answer from Publidata.',
    });
  }
  // "single" = the services of THIS address's sector; "multiple" are the
  // generic drop-off points of the whole territory.
  return hits
    .map((hit) => hit._source ?? {})
    .filter((s) => s.metas?.sectorization === 'single' && s.metas?.garbage_types?.length)
    .map((s) => ({
      code: s.metas.garbage_types[0],
      name: s.name ?? '',
      schedules: (s.schedules ?? []).map((sc) => ({
        type: sc.schedule_type,
        openingHours: sc.opening_hours,
        startAt: sc.start_at,
        endAt: sc.end_at,
      })),
    }));
}

/** "Collecte du verre - Porte-à-porte - …" → "Verre" */
export function serviceLabel(name) {
  const first = String(name ?? '').split(' - ')[0];
  const label = first.replace(/^collecte\s+(des|du|de la|de l'|d')\s*/i, '').trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : '';
}

const dayOf = (iso) => (iso ? parseDate(String(iso).slice(0, 10)) : null);

/**
 * Compile the services into one day matcher per waste type. A schedule whose
 * syntax is not supported is skipped (and reported), never guessed.
 * @returns {{ types: Map<string, { label: string, match: (dn: number) => boolean }>, warnings: string[], ambiguous: string[] }}
 *   ambiguous: types served by several sectors at that address (a street
 *   without number may span sectors): their days are merged, the user should
 *   give a house number
 */
export function compileServices(services) {
  const warnings = [];
  const ambiguous = [];
  const byType = new Map();
  for (const service of services) {
    const key = wasteKey(service.code);
    if (!byType.has(key)) {
      byType.set(key, { label: serviceLabel(service.name), schedules: [] });
    } else if (!ambiguous.includes(key)) {
      ambiguous.push(key);
    }
    for (const schedule of service.schedules) {
      try {
        byType.get(key).schedules.push({
          ...schedule,
          rules: parseOpeningHours(schedule.openingHours),
          start: dayOf(schedule.startAt),
          end: dayOf(schedule.endAt),
        });
      } catch (err) {
        if (!(err instanceof OpeningHoursError)) throw err;
        warnings.push(`${key}: ${err.message}`);
        logger.warn(`Skipping schedule of ${key}: ${err.message}`);
      }
    }
  }

  const types = new Map();
  for (const [key, { label, schedules }] of byType) {
    // Publidata renews the regular rules without always updating `end_at`
    // (the weekly rule of 2026 ends on 2026-12-31 and stays valid after it):
    // the regular rule(s) ending last are kept open-ended, an older one
    // superseded by a newer rule still stops at its end.
    const regulars = schedules.filter((s) => s.type === 'regular');
    const lastEnd = Math.max(...regulars.map((s) => s.end ?? Infinity));
    for (const s of regulars) {
      if (s.end === null || s.end === lastEnd) s.end = Infinity;
    }
    const inWindow = (s, dn) =>
      (s.start === null || dn >= s.start) && (s.end === null || dn <= s.end);

    const match = (dn) => {
      let open = false;
      let forceOpen = false;
      let forceClosed = false;
      for (const s of schedules) {
        if (!inWindow(s, dn)) continue;
        if (s.type === 'regular') {
          open ||= isOpen(s.rules, dn);
        } else if (s.type === 'exception') {
          if (isSelected(s.rules, dn)) {
            if (isOpen(s.rules, dn)) forceOpen = true;
            else forceClosed = true;
          }
        } else if (s.type === 'closed' || s.type === 'closing_exception') {
          forceClosed ||= isSelected(s.rules, dn);
        }
      }
      return forceOpen || (open && !forceClosed);
    };
    types.set(key, { label, match });
  }
  return { types, warnings, ambiguous };
}
