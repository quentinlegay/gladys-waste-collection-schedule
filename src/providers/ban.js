// -----------------------------------------------------------------------------
// Reverse geocoding with the Base Adresse Nationale (IGN Géoplateforme).
//
// Gladys only gives the COORDINATES of a house (`gladys.getHouses()`), while
// the collection sector is selected by an ADDRESS id. The BAN finds the
// nearest address of a point, with the same id format Publidata uses
// (`35007_0024_00001`): https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ProviderError } from './publidata.js';

const logger = createLogger({ name: 'ban' });

export const REVERSE_URL = 'https://data.geopf.fr/geocodage/reverse';
const TIMEOUT_MS = 15_000;
// Beyond this distance, the house pin is probably not on the right building.
export const MAX_DISTANCE_M = 150;

/**
 * Nearest address of a point.
 * @param {{ latitude: number, longitude: number }} point
 * @returns {Promise<{ id: string, label: string, citycode: string, distance: number }>}
 */
export async function reverseGeocode({ latitude, longitude }) {
  const url = new URL(REVERSE_URL);
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  url.searchParams.set('index', 'address');
  url.searchParams.set('limit', '5');
  logger.debug('GET', url.href);
  let response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (err) {
    throw new ProviderError({
      fr: `Base Adresse Nationale injoignable (${err.message}).`,
      en: `Base Adresse Nationale unreachable (${err.message}).`,
    });
  }
  if (!response.ok) {
    throw new ProviderError({
      fr: `La Base Adresse Nationale a répondu HTTP ${response.status}.`,
      en: `The Base Adresse Nationale answered HTTP ${response.status}.`,
    });
  }
  const body = await response.json();
  const features = body?.features ?? [];
  // A house number, as for a typed address: a street id may span sectors.
  const best =
    features.find((f) => f.properties?.type === 'housenumber') ??
    features.find((f) => f.properties?.id);
  if (!best) {
    throw new ProviderError({
      fr: 'Aucune adresse trouvée à la position de la maison. Vérifiez sa position dans Gladys, ou saisissez une adresse.',
      en: 'No address found at the house position. Check its position in Gladys, or type an address.',
    });
  }
  const { id, label, citycode, distance = 0 } = best.properties;
  return { id, label, citycode, distance: Math.round(distance) };
}
