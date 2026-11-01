// GET /api/videos?q=<search>&lang=he|en
// Up to 4 YouTube videos for one search, with their length. Needs YOUTUBE_API_KEY.
// A search costs 100 units of the daily YouTube quota (10,000 free), so answers are cached for a day.
import { json, getJson, qs, clean, BASE, CACHE_DAY, UpstreamError } from '../lib/http.js';
import { mapYouTube } from '../lib/media.js';

export async function GET(request) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return json({ items: [], error: 'not_configured' });
  const url = new URL(request.url);
  const q = clean(url.searchParams.get('q'), 160);
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'he';
  if (!q) return json({ items: [], error: 'bad_request' }, 400);
  try {
    const search = await getJson(BASE.youtube() + '/search?' + qs({
      part: 'snippet', type: 'video', maxResults: 8, q, relevanceLanguage: lang,
      safeSearch: 'strict', videoEmbeddable: 'true', key,
    }));
    const ids = ((search && search.items) || []).map(i => i && i.id && i.id.videoId).filter(Boolean);
    const details = ids.length
      ? await getJson(BASE.youtube() + '/videos?' + qs({ part: 'contentDetails,status', id: ids.join(','), key }))
      : { items: [] };
    return json({ items: mapYouTube(search, details, 4) }, 200, CACHE_DAY);
  } catch (e) {
    const reason = e instanceof UpstreamError && e.body && e.body.error && e.body.error.errors && e.body.error.errors[0] && e.body.error.errors[0].reason;
    console.error(JSON.stringify({ evt: 'videos_error', status: e && e.status, reason: reason || (e && e.name) }));
    return json({ items: [], error: reason === 'quotaExceeded' ? 'quota' : 'upstream_error' });
  }
}
