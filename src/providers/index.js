// -----------------------------------------------------------------------------
// Provider registry.
//
// The `key` is FROZEN: it is the value stored in the `provider` config field.
// To add a collection service running on Publidata, add an entry with its
// instance id (read it in the widget's page: `"instance_id": 1003`) and the
// matching option in the manifest `provider` select. Another platform gets its
// own module next to publidata.js, exposing the same `load()` contract.
// -----------------------------------------------------------------------------

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

/**
 * Identity of what a provider downloads for a config: when it changes, the
 * cached data is not valid any more.
 */
export function providerQuery(config) {
  const provider = findProvider(config.provider);
  if (!provider.platform) {
    return null;
  }
  return {
    provider,
    instanceId: provider.instanceId ?? config.publidata_instance,
    address: config.address,
    inseeCode: config.insee_code,
  };
}

/**
 * Download the raw collection services of a query.
 * @returns {Promise<{ address: string, services: object[] }>}
 * @throws {publidata.ProviderError}
 */
export async function download(query) {
  if (!query.instanceId) {
    throw new publidata.ProviderError({
      fr: "Renseignez l'identifiant d'instance Publidata de votre collectivité.",
      en: 'Fill in the Publidata instance id of your collection service.',
    });
  }
  const address = await query.provider.platform.geocode(query);
  const services = await query.provider.platform.fetchServices({
    instanceId: query.instanceId,
    addressId: address.id,
  });
  if (!services.length) {
    throw new publidata.ProviderError({
      fr: `Aucune collecte trouvée chez ${query.provider.name.fr} pour « ${address.label} ». Vérifiez l'adresse (ou le code INSEE) et le fournisseur choisi.`,
      en: `No collection found at ${query.provider.name.en} for "${address.label}". Check the address (or the INSEE code) and the chosen provider.`,
    });
  }
  return { address: address.label, services };
}

export { ProviderError } from './publidata.js';
