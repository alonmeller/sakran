// GET /api/photos?en=<English title>&he=<Hebrew title>
// Free-license photos from the topic's Wikipedia article (Wikimedia Commons), with author and license.
// Falls back to a Wikimedia Commons search. No key needed.
import { json, getJson, qs, clean, BASE, CACHE_WEEK } from '../lib/http.js';
import { pickFiles, mapImageInfo } from '../lib/media.js';

const INFO = {
  action: 'query', format: 'json', formatversion: 2, prop: 'imageinfo',
  iiprop: 'url|size|mime|extmetadata', iiurlwidth: 960,
  iiextmetadatafilter: 'Artist|Credit|LicenseShortName|LicenseUrl|NonFree',
};

async function fromArticle(lang, title) {
  const page = encodeURIComponent(title.replace(/ /g, '_'));
  let list;
  try {
    list = await getJson(BASE.wikipedia(lang) + '/api/rest_v1/page/media-list/' + page + '?redirect=true');
  } catch (e) {
    if (e && e.status === 404) return [];
    throw e;
  }
  const files = pickFiles(list, 12);
  if (!files.length) return [];
  const info = await getJson(BASE.wikipedia(lang) + '/w/api.php?' + qs({ ...INFO, titles: files.join('|') }));
  return mapImageInfo(info, files, 4);
}

async function fromCommons(query) {
  const info = await getJson(BASE.commons() + '/w/api.php?' + qs({
    ...INFO, generator: 'search', gsrsearch: query + ' filetype:bitmap', gsrnamespace: 6, gsrlimit: 12,
  }));
  return mapImageInfo(info, [], 4);
}

export async function GET(request) {
  const url = new URL(request.url);
  const en = clean(url.searchParams.get('en'), 120);
  const he = clean(url.searchParams.get('he'), 120);
  if (!en && !he) return json({ items: [], error: 'bad_request' }, 400);
  try {
    let items = en ? await fromArticle('en', en) : [];
    if (items.length < 2 && he) items = items.concat((await fromArticle('he', he)).filter(p => !items.some(x => x.title === p.title)));
    if (items.length < 2 && en) items = items.concat((await fromCommons(en)).filter(p => !items.some(x => x.title === p.title)));
    return json({ items: items.slice(0, 4) }, 200, CACHE_WEEK);
  } catch (e) {
    console.error(JSON.stringify({ evt: 'photos_error', status: e && e.status, name: e && e.name }));
    return json({ items: [], error: 'upstream_error' });
  }
}
