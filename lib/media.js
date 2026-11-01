// Turning answers from YouTube, Wikipedia/Wikimedia Commons and Apple (iTunes) into
// the small objects the app shows. Pure functions, so they are easy to test.

/* ---------- text ---------- */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

/** YouTube titles arrive HTML-escaped (&#39; &amp; ...). */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Plain text from a bit of HTML (Wikimedia credits come as HTML). */
export function stripHtml(s) {
  return decodeEntities(String(s ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Lower case, no accents, no niqqud, no punctuation: for comparing names. */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u0591-\u05c7]/g, '') // accents and niqqud
    .toLowerCase()
    .replace(/[\u05f4"'`\u05f3\u2019\u2018]/g, '') // gershayim, geresh and quotes
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A song or show title without the extras stores add: (feat. X), - Remastered 2011, [Live] ... */
export function baseTitle(s) {
  return normalize(String(s ?? '').replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+-\s+.*$/, ''));
}

/** How well two titles match: 3 the same, 2 the same without extras, 1 one adds a word or two, 0 different. */
export function titleScore(a, b) {
  if (normalize(a) && normalize(a) === normalize(b)) return 3;
  const x = baseTitle(a), y = baseTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 2;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const extra = long.split(' ').length - short.split(' ').length;
  return short.includes(' ') && long.startsWith(short + ' ') && extra <= 2 ? 1 : 0;
}
export const sameTitle = (a, b) => titleScore(a, b) > 0;

/** How well two names match: 3 the same, 2 the same apart from "the" or extras in brackets, 1 one name inside the other, 0 different. */
export function nameScore(a, b) {
  const x = normalize(a), y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 3;
  const bare = s => normalize(String(s ?? '').replace(/\s*[([].*?[)\]]\s*/g, ' ')).replace(/^the /, '');
  if (bare(a) && bare(a) === bare(b)) return 2;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && (' ' + long + ' ').includes(' ' + short + ' ') ? 1 : 0;
}
export const sameName = (a, b) => nameScore(a, b) > 0;

/* versions that are not the original recording, and acts that only copy one */
const NOT_ORIGINAL = /\b(karaoke|tribute|cover|covers|in the style of|made famous|originally performed|lullaby|8 bit|instrumental)\b/;
const NOT_STUDIO = /\b(live|remix|acoustic|demo|edit|version|mix)\b/;

/* ---------- YouTube ---------- */

/** "PT1H2M3S" -> 3723 */
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(iso || ''));
  if (!m) return 0;
  return Math.round((+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0));
}

/**
 * search.list + videos.list -> [{ id, title, channel, duration }]
 * Keeps embeddable, non-live videos between 1 and 25 minutes when there are such.
 */
export function mapYouTube(search, details, max = 4) {
  const info = new Map();
  for (const v of (details && details.items) || []) {
    info.set(v.id, {
      duration: parseDuration(v.contentDetails && v.contentDetails.duration),
      embeddable: !(v.status && v.status.embeddable === false),
      kids: !!(v.status && v.status.madeForKids),
    });
  }
  const all = [];
  const seen = new Set();
  for (const it of (search && search.items) || []) {
    const id = it && it.id && it.id.videoId;
    const sn = (it && it.snippet) || {};
    if (!id || !/^[\w-]{6,20}$/.test(id) || seen.has(id)) continue;
    if (sn.liveBroadcastContent && sn.liveBroadcastContent !== 'none') continue;
    const extra = info.get(id) || { duration: 0, embeddable: true };
    if (!extra.embeddable) continue;
    seen.add(id);
    all.push({ id, title: decodeEntities(sn.title), channel: decodeEntities(sn.channelTitle), duration: extra.duration });
  }
  const good = all.filter(v => !v.duration || (v.duration >= 60 && v.duration <= 25 * 60));
  return (good.length ? good : all).slice(0, max);
}

/* ---------- Wikipedia / Wikimedia Commons ---------- */

const SKIP_FILE = /(logo|icon|flag|map|symbol|signature|seal|coat[_ ]of[_ ]arms|wikiquote|wiktionary|commons-|wikinews|question[_ ]book|ambox|edit-clear|padlock|disambig|stub|portal|crystal[_ ]clear|nuvola|gnome|blank|placeholder|location[_ ]dot|locator)/i;
const RASTER = /\.(jpe?g|png|webp|tiff?)$/i;

/** File titles worth asking about, from a REST media-list answer, in page order. */
export function pickFiles(mediaList, max = 10) {
  const out = [];
  for (const it of (mediaList && mediaList.items) || []) {
    const t = it && it.title;
    if (!t || it.type !== 'image' || !RASTER.test(t) || SKIP_FILE.test(t)) continue;
    if (it.showInGallery === false) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** imageinfo answer (formatversion=2) -> photos with credits, free licenses only. */
export function mapImageInfo(answer, order = [], max = 4) {
  const pages = (answer && answer.query && answer.query.pages) || [];
  const list = Array.isArray(pages) ? pages : Object.values(pages);
  const photos = [];
  for (const p of list) {
    const ii = p && p.imageinfo && p.imageinfo[0];
    if (!ii) continue;
    const meta = ii.extmetadata || {};
    const val = k => (meta[k] && meta[k].value) || '';
    const license = stripHtml(val('LicenseShortName'));
    const nonFree = String(val('NonFree')).toLowerCase() === 'true' || /fair use|non-free/i.test(license);
    if (nonFree || !license) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(ii.mime || '')) continue;
    if ((ii.width || 0) < 640 || (ii.height || 0) < 400) continue;
    const ratio = (ii.width || 1) / (ii.height || 1);
    if (ratio < 0.6 || ratio > 2.4) continue;
    const src = ii.thumburl || ii.url;
    if (!src || !/^https:\/\/upload\.wikimedia\.org\//.test(src)) continue;
    let author = stripHtml(val('Artist')) || stripHtml(val('Credit'));
    if (author.length > 80) author = author.slice(0, 77) + '...';
    photos.push({
      title: p.title,
      src,
      w: ii.thumbwidth || ii.width,
      h: ii.thumbheight || ii.height,
      page: ii.descriptionurl || '',
      author: author || 'לא צוין',
      license,
      licenseUrl: /^https?:\/\//.test(val('LicenseUrl')) ? val('LicenseUrl') : '',
    });
  }
  const rank = t => { const i = order.indexOf(t); return i < 0 ? 999 : i; };
  photos.sort((a, b) => rank(a.title) - rank(b.title));
  return photos.slice(0, max);
}

/* ---------- Apple (iTunes Search) ---------- */

const bigArt = (url, size) => (url ? String(url).replace(/\/\d+x\d+(bb)?\.(jpg|png|webp)$/i, `/${size}x${size}bb.jpg`) : '');
const https = url => (/^https:\/\//.test(url || '') ? url : '');

/** The store result that is this song, or null. Prefers the original artist and the studio recording. */
export function matchSong(results, title, artist) {
  let best = null, bestScore = 0;
  for (const r of results || []) {
    if (!r || r.kind !== 'song') continue;
    const t = titleScore(r.trackName, title);
    if (!t) continue;
    const a = artist ? Math.max(nameScore(r.artistName, artist), nameScore(r.collectionArtistName, artist)) : 1;
    if (!a) continue;
    if (NOT_ORIGINAL.test(normalize([r.artistName, r.trackName, r.collectionName].join(' ')))) continue;
    let score = a * 10 + t * 3;
    if (NOT_STUDIO.test(normalize(r.trackName))) score -= 4;
    if (score > bestScore) { best = r; bestScore = score; }
  }
  if (best) {
    const r = best;
    return {
      title: r.trackName,
      artist: r.artistName,
      album: r.collectionName || '',
      year: r.releaseDate ? String(r.releaseDate).slice(0, 4) : '',
      artwork: https(bigArt(r.artworkUrl100, 300)),
      preview: https(r.previewUrl),
      url: https(r.trackViewUrl),
    };
  }
  return null;
}

/** The store result that is this podcast show, or null. */
export function matchShow(results, name) {
  let best = null, bestScore = 0;
  for (const r of results || []) {
    if (!r || (r.kind && r.kind !== 'podcast')) continue;
    const score = Math.max(titleScore(r.collectionName, name), nameScore(r.collectionName, name));
    if (score > bestScore) { best = r; bestScore = score; }
  }
  if (best) {
    const r = best;
    return {
      name: r.collectionName,
      author: r.artistName || '',
      artwork: https(r.artworkUrl600 || bigArt(r.artworkUrl100, 600)),
      url: https(r.collectionViewUrl),
    };
  }
  return null;
}

/** Podcast episodes from a search, newest information the store gives. */
export function mapEpisodes(results, max = 3) {
  const out = [];
  const seen = new Set();
  for (const r of results || []) {
    if (!r || r.kind !== 'podcast-episode') continue;
    const audio = https(r.episodeUrl);
    if (!audio || !r.trackName) continue;
    const key = normalize(r.trackName);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: r.trackName,
      show: r.collectionName || '',
      artwork: https(r.artworkUrl600 || r.artworkUrl160 || r.artworkUrl60),
      audio,
      url: https(r.trackViewUrl || r.collectionViewUrl),
      date: r.releaseDate ? String(r.releaseDate).slice(0, 10) : '',
      duration: r.trackTimeMillis ? Math.round(r.trackTimeMillis / 1000) : 0,
    });
    if (out.length >= max) break;
  }
  return out;
}
