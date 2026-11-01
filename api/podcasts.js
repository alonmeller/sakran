// GET /api/podcasts?name=<show>            -> checks that a recommended show exists: cover and link
// GET /api/podcasts?he=<topic>&en=<topic>  -> existing episodes about the topic, playable in the page
// Apple's iTunes Search, no key needed.
import { json, getJson, qs, clean, BASE, CACHE_DAY, CACHE_WEEK } from '../lib/http.js';
import { matchShow, mapEpisodes } from '../lib/media.js';

const search = params => getJson(BASE.itunes() + '/search?' + qs({ media: 'podcast', country: 'IL', ...params }));

export async function GET(request) {
  const url = new URL(request.url);
  const name = clean(url.searchParams.get('name'), 120);
  const he = clean(url.searchParams.get('he'), 120);
  const en = clean(url.searchParams.get('en'), 120);
  try {
    if (name) {
      const show = matchShow((await search({ term: name, entity: 'podcast', limit: 10 })).results, name);
      return json(show ? { found: true, show } : { found: false }, 200, CACHE_WEEK);
    }
    if (!he && !en) return json({ items: [], error: 'bad_request' }, 400);
    let items = he ? mapEpisodes((await search({ term: he, entity: 'podcastEpisode', limit: 15 })).results, 3) : [];
    if (items.length < 3 && en) {
      const more = mapEpisodes((await search({ term: en, entity: 'podcastEpisode', limit: 15 })).results, 3);
      for (const ep of more) if (items.length < 3 && !items.some(x => x.audio === ep.audio)) items.push(ep);
    }
    return json({ items }, 200, CACHE_DAY);
  } catch (e) {
    console.error(JSON.stringify({ evt: 'podcasts_error', status: e && e.status, name: e && e.name }));
    return json(name ? { found: false, error: 'upstream_error' } : { items: [], error: 'upstream_error' });
  }
}
