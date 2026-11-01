// Stand-ins for Claude, YouTube, Wikipedia / Wikimedia Commons and iTunes, used by the tests.
import http from 'node:http';

const parse = s => { try { return JSON.parse(s); } catch { return s; } };

/** A local HTTP server that records every call and answers with `handler(call, res)`. */
export async function startMock(handler) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url, 'http://localhost');
    const call = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body: text ? parse(text) : null };
    calls.push(call);
    try {
      await handler(call, res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500);
      res.end(String(e));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: 'http://127.0.0.1:' + port,
    calls,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

export function sendJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/** The server-sent events of one streamed Messages API answer that writes `text`. */
export function messageEvents(text, { stop = 'end_turn', model = 'test-model', chunk = 40, thinking = true } = {}) {
  const ev = [];
  ev.push(['message_start', { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } } }]);
  let i = 0;
  if (thinking) {
    ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'thinking', thinking: '', signature: '' } }]);
    ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'c2lnbmF0dXJl' } }]);
    ev.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
    i++;
  }
  ev.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } }]);
  for (let p = 0; p < text.length; p += chunk) {
    ev.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: text.slice(p, p + chunk) } }]);
  }
  ev.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
  ev.push(['message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: Math.ceil(text.length / 3) } }]);
  ev.push(['message_stop', { type: 'message_stop' }]);
  return ev;
}

/** Stream events as text/event-stream, optionally slowly. */
export async function sse(res, events, { delay = 0 } = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'request-id': 'req_test' });
  for (const [event, data] of events) {
    if (res.destroyed) return;
    res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    if (delay) await wait(delay);
  }
  res.end();
}

/** A Messages API error answer. `x-should-retry: false` keeps the SDK from retrying it. */
export function apiError(res, status, type, message) {
  sendJson(res, status, { type: 'error', error: { type, message } }, { 'x-should-retry': 'false', 'request-id': 'req_test' });
}

/* ---------- sample answers from the media services ---------- */

export const youtubeSearch = {
  items: [
    { id: { kind: 'youtube#video', videoId: 'vid_AAAAAA1' }, snippet: { title: 'Black Holes Explained &ndash; From Birth to Death', channelTitle: 'Kurzgesagt &amp; Friends', liveBroadcastContent: 'none' } },
    { id: { kind: 'youtube#video', videoId: 'vid_LIVE001' }, snippet: { title: 'Live now', channelTitle: 'Live', liveBroadcastContent: 'live' } },
    { id: { kind: 'youtube#video', videoId: 'vid_LONG001' }, snippet: { title: 'A three hour lecture', channelTitle: 'Uni', liveBroadcastContent: 'none' } },
    { id: { kind: 'youtube#video', videoId: 'vid_NOEMB01' }, snippet: { title: 'Not embeddable', channelTitle: 'X', liveBroadcastContent: 'none' } },
    { id: { kind: 'youtube#video', videoId: 'vid_HEB0001' }, snippet: { title: 'חורים שחורים &#39;בקצרה&#39;', channelTitle: 'מדע בעברית', liveBroadcastContent: 'none' } },
  ],
};
export const youtubeVideos = {
  items: [
    { id: 'vid_AAAAAA1', contentDetails: { duration: 'PT6M29S' }, status: { embeddable: true } },
    { id: 'vid_LONG001', contentDetails: { duration: 'PT3H1M' }, status: { embeddable: true } },
    { id: 'vid_NOEMB01', contentDetails: { duration: 'PT4M' }, status: { embeddable: false } },
    { id: 'vid_HEB0001', contentDetails: { duration: 'PT9M5S' }, status: { embeddable: true } },
  ],
};

export const mediaList = {
  items: [
    { title: 'File:Black_hole_-_Messier_87_crop_max_res.jpg', type: 'image', showInGallery: true },
    { title: 'File:Commons-logo.svg', type: 'image' },
    { title: 'File:Wikimedia_logo_small.png', type: 'image' },
    { title: 'File:Gravitational_lens.webm', type: 'video' },
    { title: 'File:Sagittarius_A*_black_hole.jpg', type: 'image' },
    { title: 'File:Tiny_diagram.png', type: 'image' },
    { title: 'File:Fair_use_poster.jpg', type: 'image' },
  ],
};

const meta = (artist, license, extra = {}) => ({
  Artist: { value: artist }, LicenseShortName: { value: license }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0' }, ...extra,
});
export const imageInfo = {
  query: {
    pages: [
      { title: 'File:Sagittarius_A*_black_hole.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a/sgr.jpg', thumburl: 'https://upload.wikimedia.org/a/960px-sgr.jpg', thumbwidth: 960, thumbheight: 960, width: 3000, height: 3000, mime: 'image/jpeg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Sgr', extmetadata: meta('<a href="//x">EHT Collaboration</a>', 'CC BY 4.0') }] },
      { title: 'File:Black_hole_-_Messier_87_crop_max_res.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a/m87.jpg', thumburl: 'https://upload.wikimedia.org/a/960px-m87.jpg', thumbwidth: 960, thumbheight: 640, width: 4000, height: 2667, mime: 'image/jpeg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:M87', extmetadata: meta('Event Horizon Telescope', 'CC BY 4.0') }] },
      { title: 'File:Tiny_diagram.png', imageinfo: [{ url: 'https://upload.wikimedia.org/a/tiny.png', width: 300, height: 200, mime: 'image/png', extmetadata: meta('Someone', 'CC0') }] },
      { title: 'File:Fair_use_poster.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/a/poster.jpg', width: 1200, height: 800, mime: 'image/jpeg', extmetadata: meta('Studio', 'Fair use', { NonFree: { value: 'true' } }) }] },
    ],
  },
};

export const itunesSongs = {
  resultCount: 2,
  results: [
    { kind: 'song', trackName: 'Supermassive Black Hole (Live)', artistName: 'Muse (Tribute Band)', collectionName: 'Covers', releaseDate: '2010-01-01T00:00:00Z' },
    { kind: 'song', trackName: 'Supermassive Black Hole', artistName: 'Muse', collectionName: 'Black Holes and Revelations', releaseDate: '2006-06-19T07:00:00Z', artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/p/preview.m4a', trackViewUrl: 'https://music.apple.com/il/album/x?i=1' },
  ],
};
export const itunesShows = {
  results: [
    { kind: 'podcast', collectionName: 'StarTalk Radio', artistName: 'Neil deGrasse Tyson', artworkUrl600: 'https://is1-ssl.mzstatic.com/image/thumb/s/600x600bb.jpg', collectionViewUrl: 'https://podcasts.apple.com/il/podcast/startalk/id1' },
  ],
};
export const itunesEpisodes = {
  results: [
    { kind: 'podcast-episode', trackName: 'What is inside a black hole?', collectionName: 'StarTalk Radio', episodeUrl: 'https://cdn.example.com/ep1.mp3', artworkUrl600: 'https://is1-ssl.mzstatic.com/image/thumb/e/600x600bb.jpg', trackViewUrl: 'https://podcasts.apple.com/il/podcast/x?i=1', releaseDate: '2024-03-01T00:00:00Z', trackTimeMillis: 2700000 },
    { kind: 'podcast-episode', trackName: 'What is inside a black hole?', collectionName: 'Copy', episodeUrl: 'https://cdn.example.com/dup.mp3' },
    { kind: 'podcast-episode', trackName: 'Plain http episode', collectionName: 'Old', episodeUrl: 'http://insecure.example.com/ep.mp3' },
    { kind: 'podcast-episode', trackName: 'חורים שחורים בעברית', collectionName: 'מדע בכיס', episodeUrl: 'https://cdn.example.com/he.mp3', trackTimeMillis: 1500000 },
  ],
};
