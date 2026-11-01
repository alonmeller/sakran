// GET /api/music?title=<song>&artist=<performer>
// Checks that a song really exists (Apple's iTunes Search), and returns its cover, a 30-second preview and a link.
// No key needed.
import { json, getJson, qs, clean, BASE, CACHE_WEEK } from '../lib/http.js';
import { matchSong } from '../lib/media.js';

const search = term => getJson(BASE.itunes() + '/search?' + qs({ term, media: 'music', entity: 'song', limit: 25, country: 'IL' }));

export async function GET(request) {
  const url = new URL(request.url);
  const title = clean(url.searchParams.get('title'), 120);
  const artist = clean(url.searchParams.get('artist'), 120);
  if (!title) return json({ found: false, error: 'bad_request' }, 400);
  try {
    let song = matchSong((await search(title + ' ' + artist)).results, title, artist);
    if (!song) song = matchSong((await search(title)).results, title, artist);
    return json(song ? { found: true, song } : { found: false }, 200, CACHE_WEEK);
  } catch (e) {
    console.error(JSON.stringify({ evt: 'music_error', status: e && e.status, name: e && e.name }));
    return json({ found: false, error: 'upstream_error' });
  }
}
