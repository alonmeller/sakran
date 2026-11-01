// Small helpers shared by the API functions.

const UA = 'Sakran/0.1 (learning app; https://github.com/alonmeller/sakran)';

/** A JSON response. Not cached unless `cache` says otherwise. */
export function json(data, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
      'x-content-type-options': 'nosniff',
    },
  });
}

/** Cache header for answers that stay true for a while (search results, photo lists). */
export const CACHE_DAY = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';
export const CACHE_WEEK = 'public, max-age=3600, s-maxage=604800, stale-while-revalidate=2592000';

export class UpstreamError extends Error {
  constructor(status, body) {
    super('upstream ' + status);
    this.status = status;
    this.body = body;
  }
}

/** GET a JSON document from another service, with a time limit. */
export async function getJson(url, { timeout = 8000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, 'api-user-agent': UA, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    let body = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    throw new UpstreamError(res.status, body);
  }
  return res.json();
}

/** Build a query string, skipping empty values. */
export function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  }
  return u.toString();
}

/** A short, single-line string from user input. */
export function clean(value, max = 120) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Base addresses of the outside services; the tests point them at local mocks. */
export const BASE = {
  youtube: () => process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com/youtube/v3',
  wikipedia: lang => (process.env.WIKIPEDIA_BASE || 'https://{lang}.wikipedia.org').replace('{lang}', lang),
  commons: () => process.env.COMMONS_BASE || 'https://commons.wikimedia.org',
  itunes: () => process.env.ITUNES_BASE || 'https://itunes.apple.com',
};
