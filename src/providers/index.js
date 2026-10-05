// -----------------------------------------------------------------------------
// Provider registry.
//
// The `key` is FROZEN: it is the value stored in the `provider` config field.
// To add a collection service running on Publidata, add an entry with its
// instance id (read it in the widget's page: `"instance_id": 1003`) and the
// matching option in the manifest `provider` select. Another platform gets its
// own module next to publidata.js, exposing the same `load()` contract.
// -----------------------------------------------------------------------------

import { reverseGeocode } from './ban.js';
import * as publidata from './publidata.js';

export const CUSTOM = 'custom';

export const PROVIDERS = {
  [CUSTOM]: {
    key: CUSTOM,
    name: { fr: 'Mon propre planning', en: 'My own schedule' },
  },
  valcobreizh: {
    key: 'valcobreizh',
    name: { fr: 'SMICTOM Valcobreizh', en: 'SMICTOM Valcobreizh' },
    platform: publidata,
    instanceId: 1003,
  },
  publidata: {
    key: 'publidata',
    name: { fr: 'Publidata (autre collectivité)', en: 'Publidata (other service)' },
    platform: publidata,
    // instance id taken from the `publidata_instance` config field
    instanceId: null,
  },
};

export function findProvider(key) {
  return PROVIDERS[key] ?? PROVIDERS[CUSTOM];
}

/** Name comparison: case, accents and spaces ignored. */
const simplify = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * House of Gladys whose position locates the collections, when no address is
 * typed: the one named in the `house` config field (name or selector), else
 * the first located house (`getHouses()` sorts them by name).
 * @param {{ house: string }} config
 * @param {{ name: string, selector: string, latitude: number|null, longitude: number|null }[]} houses
 * @returns {{ house: object|null, error: { fr: string, en: string }|null }}
 */
export function pickHouse(config, houses = []) {
  const located = houses.filter((h) => h.latitude !== null && h.longitude !== null);
  const names = houses.map((h) => `« ${h.name} »`).join(', ');
  const namesEn = houses.map((h) => `"${h.name}"`).join(', ');
  if (config.house) {
    const wanted = simplify(config.house);
    const house = houses.find(
      (h) => simplify(h.name) === wanted || simplify(h.selector) === wanted,
    );
    if (!house) {
      return {
        house: null,
        error: {
          fr: `Maison « ${config.house} » introuvable dans Gladys${names ? ` (maisons : ${names})` : ''}.`,
          en: `House "${config.house}" not found in Gladys${namesEn ? ` (houses: ${namesEn})` : ''}.`,
        },
      };
    }
    if (!located.includes(house)) {
      return {
        house: null,
        error: {
          fr: `La maison « ${house.name} » n'a pas de position : placez-la sur la carte dans Gladys (Paramètres → Maisons), ou saisissez une adresse.`,
          en: `The house "${house.name}" has no position: place it on the map in Gladys (Settings → Houses), or type an address.`,
        },
      };
    }
    return { house, error: null };
  }
  if (!located.length) {
    return {
      house: null,
      error: {
        fr: "Aucune maison de Gladys n'a de position : placez votre maison sur la carte (Paramètres → Maisons), ou saisissez une adresse.",
        en: 'No Gladys house has a position: place your house on the map (Settings → Houses), or type an address.',
      },
    };
  }
  return { house: located[0], error: null };
}

/**
 * Identity of what a provider downloads for a config: when it changes, the
 * cached data is not valid any more.
 * @param {object} config normalized configuration
 * @param {object[]} [houses] houses of Gladys (`gladys.getHouses()`)
 */
export function providerQuery(config, houses = []) {
  const provider = findProvider(config.provider);
  if (!provider.platform) {
    return null;
  }
  const query = {
    provider,
    instanceId: provider.instanceId ?? config.publidata_instance,
    address: config.address,
    inseeCode: config.insee_code,
    house: null,
    houseError: null,
  };
  // A typed address wins: it is the way to correct a badly placed house.
  if (!config.address) {
    const { house, error } = pickHouse(config, houses);
    query.house = house && {
      name: house.name,
      latitude: house.latitude,
      longitude: house.longitude,
    };
    query.houseError = error;
  }
  return query;
}

/**
 * Download the raw collection services of a query.
 * @returns {Promise<{ address: string, house: string|null, distance: number|null, services: object[] }>}
 * @throws {publidata.ProviderError}
 */
export async function download(query) {
  if (!query.instanceId) {
    throw new publidata.ProviderError({
      fr: "Renseignez l'identifiant d'instance Publidata de votre collectivité.",
      en: 'Fill in the Publidata instance id of your collection service.',
    });
  }
  if (query.houseError) {
    throw new publidata.ProviderError(query.houseError);
  }
  const address = query.address
    ? await query.provider.platform.geocode(query)
    : await reverseGeocode(query.house);
  const services = await query.provider.platform.fetchServices({
    instanceId: query.instanceId,
    addressId: address.id,
  });
  if (!services.length) {
    throw new publidata.ProviderError({
      fr: `Aucune collecte trouvée chez ${query.provider.name.fr} pour « ${address.label} ». Vérifiez l'adresse (ou la position de la maison) et le fournisseur choisi.`,
      en: `No collection found at ${query.provider.name.en} for "${address.label}". Check the address (or the house position) and the chosen provider.`,
    });
  }
  return {
    address: address.label,
    house: query.house?.name ?? null,
    distance: query.house ? address.distance : null,
    services,
  };
}

export { ProviderError } from './publidata.js';
