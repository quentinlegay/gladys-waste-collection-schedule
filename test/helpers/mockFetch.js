// -----------------------------------------------------------------------------
// Replace the global `fetch` with canned Publidata answers (the real ones,
// recorded for 1 rue de la Mairie, 35250 Aubigné — SMICTOM Valcobreizh — and
// the BAN reverse geocoding of that point).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

export const GEOCODER_AUBIGNE = fixture('publidata-geocoder-aubigne.json');
export const SEARCH_AUBIGNE = fixture('publidata-search-aubigne.json');
export const REVERSE_AUBIGNE = fixture('ban-reverse-aubigne.json');

/**
 * Install a fake fetch. `routes` maps a URL pathname to a body (or to a
 * function of the URL returning a body, or to an Error to throw).
 * @returns {{ calls: URL[], restore: () => void }}
 */
export function mockFetch(routes) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    let body = routes[url.pathname];
    if (typeof body === 'function') body = body(url);
    if (body instanceof Error) throw body;
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => structuredClone(body) };
  };
  return {
    calls,
    restore() {
      globalThis.fetch = realFetch;
    },
  };
}

/** Routes answering like Publidata (and the BAN) for Aubigné. */
export const AUBIGNE_ROUTES = {
  '/v2/geocoder': GEOCODER_AUBIGNE,
  '/v2/search': SEARCH_AUBIGNE,
  '/geocodage/reverse': REVERSE_AUBIGNE,
};
