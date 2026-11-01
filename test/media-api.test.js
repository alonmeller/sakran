// The video, photo, music and podcast APIs against stand-ins for YouTube, Wikipedia, Commons and iTunes.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, sendJson, youtubeSearch, youtubeVideos, mediaList, imageInfo, itunesSongs, itunesShows, itunesEpisodes } from './mocks.js';

let mock, reply;
let videos, photos, music, podcasts;

before(async () => {
  mock = await startMock((call, res) => reply(call, res));
  process.env.YOUTUBE_API_BASE = mock.url + '/youtube/v3';
  process.env.WIKIPEDIA_BASE = mock.url + '/wiki/{lang}';
  process.env.COMMONS_BASE = mock.url + '/commons';
  process.env.ITUNES_BASE = mock.url + '/itunes';
  videos = (await import('../api/videos.js')).GET;
  photos = (await import('../api/photos.js')).GET;
  music = (await import('../api/music.js')).GET;
  podcasts = (await import('../api/podcasts.js')).GET;
});
after(() => mock.close());
beforeEach(() => {
  process.env.YOUTUBE_API_KEY = 'yt-key';
  mock.calls.length = 0;
  reply = (call, res) => sendJson(res, 404, {});
});

const get = (fn, path) => fn(new Request('http://localhost' + path));

test('videos: two YouTube calls, the right filters, cached for a day', async () => {
  reply = (call, res) => sendJson(res, 200, call.path.endsWith('/search') ? youtubeSearch : youtubeVideos);
  const res = await get(videos, '/api/videos?q=' + encodeURIComponent('חורים שחורים הסבר') + '&lang=he');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /s-maxage=86400/);
  const body = await res.json();
  assert.deepEqual(body.items.map(v => v.id), ['vid_AAAAAA1', 'vid_HEB0001']);
  const [search, details] = mock.calls;
  assert.equal(search.path, '/youtube/v3/search');
  assert.equal(search.query.key, 'yt-key');
  assert.equal(search.query.q, 'חורים שחורים הסבר');
  assert.equal(search.query.safeSearch, 'strict');
  assert.equal(search.query.videoEmbeddable, 'true');
  assert.equal(search.query.relevanceLanguage, 'he');
  assert.equal(details.path, '/youtube/v3/videos');
  assert.equal(details.query.id.split(',').length, 5);
});

test('videos: without a key nothing is called', async () => {
  delete process.env.YOUTUBE_API_KEY;
  const body = await (await get(videos, '/api/videos?q=x')).json();
  assert.deepEqual(body, { items: [], error: 'not_configured' });
  assert.equal(mock.calls.length, 0);
});

test('videos: a used-up daily quota is reported, and not cached', async () => {
  reply = (call, res) => sendJson(res, 403, { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } });
  const res = await get(videos, '/api/videos?q=x');
  assert.deepEqual(await res.json(), { items: [], error: 'quota' });
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('videos: an empty search is a bad request', async () => {
  assert.equal((await get(videos, '/api/videos?q=%20')).status, 400);
});

test('photos: from the English article, free licenses only, cached for a week', async () => {
  reply = (call, res) => {
    if (call.path === '/wiki/en/api/rest_v1/page/media-list/Black_hole') return sendJson(res, 200, mediaList);
    if (call.path === '/wiki/en/w/api.php') return sendJson(res, 200, imageInfo);
    return sendJson(res, 404, {});
  };
  const res = await get(photos, '/api/photos?en=Black%20hole&he=' + encodeURIComponent('חור שחור'));
  assert.match(res.headers.get('cache-control'), /s-maxage=604800/);
  const body = await res.json();
  assert.deepEqual(body.items.map(p => p.src), ['https://upload.wikimedia.org/a/960px-m87.jpg', 'https://upload.wikimedia.org/a/960px-sgr.jpg']);
  const info = mock.calls.find(c => c.path === '/wiki/en/w/api.php');
  assert.equal(info.query.prop, 'imageinfo');
  assert.match(info.query.titles, /Messier_87/);
  assert.ok(!mock.calls.some(c => c.path.startsWith('/commons')), 'enough photos: no Commons search');
});

test('photos: no article, so the Hebrew article and then a Commons search', async () => {
  reply = (call, res) => {
    if (call.path === '/commons/w/api.php') return sendJson(res, 200, imageInfo);
    return sendJson(res, 404, {});
  };
  const body = await (await get(photos, '/api/photos?en=Nothing&he=' + encodeURIComponent('כלום'))).json();
  assert.equal(body.items.length, 2);
  assert.ok(mock.calls.some(c => c.path.startsWith('/wiki/he/api/rest_v1/page/media-list/')));
  const search = mock.calls.find(c => c.path === '/commons/w/api.php');
  assert.equal(search.query.generator, 'search');
  assert.equal(search.query.gsrnamespace, '6');
});

test('photos: a broken service gives an empty list, not an error page', async () => {
  reply = (call, res) => sendJson(res, 500, {});
  const res = await get(photos, '/api/photos?en=Black%20hole');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { items: [], error: 'upstream_error' });
});

test('music: finds the song and its preview', async () => {
  reply = (call, res) => sendJson(res, 200, itunesSongs);
  const body = await (await get(music, '/api/music?title=Supermassive%20Black%20Hole&artist=Muse')).json();
  assert.equal(body.found, true);
  assert.equal(body.song.artist, 'Muse');
  assert.equal(mock.calls[0].query.entity, 'song');
  assert.equal(mock.calls[0].query.country, 'IL');
});

test('music: an invented song is not found, after a second search by title only', async () => {
  reply = (call, res) => sendJson(res, 200, itunesSongs);
  const body = await (await get(music, '/api/music?title=Song%20That%20Is%20Not&artist=Muse')).json();
  assert.deepEqual(body, { found: false });
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[1].query.term, 'Song That Is Not');
});

test('podcasts: a show is checked, and episodes come from Hebrew and English searches', async () => {
  reply = (call, res) => sendJson(res, 200, call.query.entity === 'podcast' ? itunesShows : itunesEpisodes);
  const show = await (await get(podcasts, '/api/podcasts?name=StarTalk')).json();
  assert.equal(show.found, true);
  assert.equal(show.show.name, 'StarTalk Radio');

  mock.calls.length = 0;
  const eps = await (await get(podcasts, '/api/podcasts?he=' + encodeURIComponent('חורים שחורים') + '&en=Black%20hole')).json();
  assert.equal(eps.items.length, 2);
  assert.ok(eps.items.every(e => e.audio.startsWith('https://')));
  assert.equal(mock.calls.length, 2, 'fewer than 3 episodes: the English search too');
  assert.equal((await get(podcasts, '/api/podcasts')).status, 400);
});
