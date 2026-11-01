/* סקרן, live preview without a server (GitHub Pages).
 * app.js is the real page, unchanged. This file answers its /api/* requests inside the browser:
 * - /api/course streams a course written in advance (black holes), at the pace of a real one
 * - /api/photos, /api/music and /api/podcasts ask Wikimedia and Apple right now, with the server's own
 *   rules (media.js is the server's lib/media.js, copied as is)
 * - /api/videos answers with real YouTube videos chosen in advance, because a YouTube search needs a key
 * It must load before app.js. */
(function () {
  'use strict';

  const TOPIC = 'חורים שחורים';
  const isTopic = s => /ה?חור(ים)?\s+ה?שחור(ים)?/.test(String(s || '')) || /black\s*holes?/i.test(String(s || ''));

  const realFetch = window.fetch.bind(window);
  let mediaP = null, courseP = null;
  const media = () => (mediaP = mediaP || import('./media.js'));
  const course = () => (courseP = courseP || realFetch('course.json').then(r => { if (!r.ok) throw new Error('course'); return r.json(); }));

  const json = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'content-type': 'application/json; charset=utf-8' } });
  const qs = p => { const u = new URLSearchParams(); Object.keys(p).forEach(k => { if (p[k] !== undefined && p[k] !== null && p[k] !== '') u.set(k, String(p[k])); }); return u.toString(); };
  const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max || 120);

  async function getJson(url) {
    const r = await realFetch(url, { headers: { accept: 'application/json' } });
    if (!r.ok) { const e = new Error('upstream ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }

  /* ---------- the course, streamed the way the server streams Claude's answer ---------- */
  const PACE = { a: { wait: 3500, secs: 30 }, b: { wait: 4200, secs: 26 }, c: { wait: 6000, secs: 30 } };
  function courseStream(part, lines, signal) {
    const text = lines.map(o => JSON.stringify(o)).join('\n') + '\n';
    const encoder = new TextEncoder();
    const pace = PACE[part] || PACE.b;
    const step = Math.max(3, Math.ceil(text.length / (pace.secs * 20) / 1.5)); /* one chunk every 50 ms */
    let pos = 0, timer = 0, closed = false;
    return new ReadableStream({
      start(ctl) {
        const stop = () => { if (closed) return; closed = true; clearTimeout(timer); try { ctl.error(new DOMException('Aborted', 'AbortError')); } catch (e) { /* already closed */ } };
        if (signal) { if (signal.aborted) { stop(); return; } signal.addEventListener('abort', stop, { once: true }); }
        const tick = () => {
          if (closed) return;
          let n = step + Math.floor(Math.random() * step);
          if (/[\ud800-\udbff]/.test(text.charAt(pos + n - 1))) n++; /* never split a surrogate pair */
          ctl.enqueue(encoder.encode(text.slice(pos, pos + n)));
          pos += n;
          if (pos >= text.length) { closed = true; ctl.close(); return; }
          timer = setTimeout(tick, 50);
        };
        timer = setTimeout(tick, pace.wait);
      },
      cancel() { closed = true; clearTimeout(timer); }
    });
  }
  async function courseApi(init) {
    let part = 'a';
    try { part = JSON.parse(init.body || '{}').part || 'a'; } catch (e) { /* default */ }
    if (!/^[abc]$/.test(part)) return json({ error: 'bad_request' }, 400);
    let all;
    try { all = await course(); } catch (e) { return json({ error: 'upstream_error' }, 502); }
    return new Response(courseStream(part, all[part], init.signal), { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  /* ---------- YouTube: real videos, chosen in advance (a live search needs an API key) ---------- */
  const VIDEOS = {
    en: [
      { id: 'e-P5IFTqB98', title: 'Black Holes Explained – From Birth to Death', channel: 'Kurzgesagt – In a Nutshell', duration: 0 }
    ],
    he: [
      { id: 'hRP4bHDZlDc', title: 'החפרנים - מה זה חור שחור?', channel: 'כאן חינוכית', duration: 206 },
      { id: 'bgW7pv2i9h4', title: 'הכל על חורים שחורים', channel: 'ScienceReasonIsrael', duration: 0 }
    ]
  };
  function videosApi(url) {
    const q = clean(url.searchParams.get('q'), 160);
    const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'he';
    if (!q) return json({ items: [], error: 'bad_request' }, 400);
    return json({ items: isTopic(q) || /kurzgesagt/i.test(q) ? VIDEOS[lang] : [] });
  }

  /* ---------- Wikimedia: the same steps as api/photos.js, asked from the browser ---------- */
  const INFO = {
    action: 'query', format: 'json', formatversion: 2, prop: 'imageinfo', origin: '*',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: 960,
    iiextmetadatafilter: 'Artist|Credit|LicenseShortName|LicenseUrl|NonFree'
  };
  const wiki = lang => 'https://' + lang + '.wikipedia.org';
  async function fromArticle(m, lang, title) {
    let list;
    try { list = await getJson(wiki(lang) + '/api/rest_v1/page/media-list/' + encodeURIComponent(title.replace(/ /g, '_')) + '?redirect=true'); }
    catch (e) { if (e && e.status === 404) return []; throw e; }
    const files = m.pickFiles(list, 12);
    if (!files.length) return [];
    const info = await getJson(wiki(lang) + '/w/api.php?' + qs(Object.assign({}, INFO, { titles: files.join('|') })));
    return m.mapImageInfo(info, files, 4);
  }
  async function fromCommons(m, query) {
    const info = await getJson('https://commons.wikimedia.org/w/api.php?' + qs(Object.assign({}, INFO, {
      generator: 'search', gsrsearch: query + ' filetype:bitmap', gsrnamespace: 6, gsrlimit: 12
    })));
    return m.mapImageInfo(info, [], 4);
  }
  async function photosApi(url) {
    const en = clean(url.searchParams.get('en')), he = clean(url.searchParams.get('he'));
    if (!en && !he) return json({ items: [], error: 'bad_request' }, 400);
    try {
      const m = await media();
      const add = (items, more) => items.concat(more.filter(p => !items.some(x => x.title === p.title)));
      let items = en ? await fromArticle(m, 'en', en) : [];
      if (items.length < 2 && he) items = add(items, await fromArticle(m, 'he', he));
      if (items.length < 2 && en) items = add(items, await fromCommons(m, en));
      return json({ items: items.slice(0, 4) });
    } catch (e) {
      return json({ items: [], error: 'upstream_error' });
    }
  }

  /* ---------- Apple (iTunes Search): the same steps as api/music.js and api/podcasts.js ---------- */
  let cbN = 0;
  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const name = '__sakranItunes' + (++cbN);
      const s = document.createElement('script');
      let t = 0;
      const done = (err, data) => { clearTimeout(t); try { delete window[name]; } catch (e) { window[name] = undefined; } s.remove(); if (err) reject(err); else resolve(data); };
      t = setTimeout(() => done(new Error('timeout')), 10000);
      window[name] = data => done(null, data);
      s.onerror = () => done(new Error('jsonp'));
      s.src = url + '&callback=' + name;
      document.head.appendChild(s);
    });
  }
  let itunesCors = null; /* unknown until the first answer */
  async function itunes(params) {
    const url = 'https://itunes.apple.com/search?' + qs(params);
    if (itunesCors !== false) {
      try {
        const r = await realFetch(url);
        if (!r.ok) { const e = new Error('upstream ' + r.status); e.status = r.status; throw e; }
        const data = await r.json();
        itunesCors = true;
        return data;
      } catch (e) {
        if ((e && e.status) || itunesCors === true) throw e;
        itunesCors = false; /* the browser refused the answer: ask the JSONP way */
      }
    }
    return jsonp(url);
  }
  async function musicApi(url) {
    const title = clean(url.searchParams.get('title')), artist = clean(url.searchParams.get('artist'));
    if (!title) return json({ found: false, error: 'bad_request' }, 400);
    try {
      const m = await media();
      const search = term => itunes({ term, media: 'music', entity: 'song', limit: 25, country: 'IL' });
      let song = m.matchSong((await search(title + ' ' + artist)).results, title, artist);
      if (!song) song = m.matchSong((await search(title)).results, title, artist);
      return json(song ? { found: true, song } : { found: false });
    } catch (e) {
      return json({ found: false, error: 'upstream_error' });
    }
  }
  async function podcastsApi(url) {
    const name = clean(url.searchParams.get('name')), he = clean(url.searchParams.get('he')), en = clean(url.searchParams.get('en'));
    const search = p => itunes(Object.assign({ media: 'podcast', country: 'IL' }, p));
    try {
      const m = await media();
      if (name) {
        const show = m.matchShow((await search({ term: name, entity: 'podcast', limit: 10 })).results, name);
        return json(show ? { found: true, show } : { found: false });
      }
      if (!he && !en) return json({ items: [], error: 'bad_request' }, 400);
      let items = he ? m.mapEpisodes((await search({ term: he, entity: 'podcastEpisode', limit: 15 })).results, 3) : [];
      if (items.length < 3 && en) {
        const more = m.mapEpisodes((await search({ term: en, entity: 'podcastEpisode', limit: 15 })).results, 3);
        more.forEach(ep => { if (items.length < 3 && !items.some(x => x.audio === ep.audio)) items.push(ep); });
      }
      return json({ items });
    } catch (e) {
      return json(name ? { found: false, error: 'upstream_error' } : { items: [], error: 'upstream_error' });
    }
  }

  /* ---------- the page's requests to its own server ---------- */
  function api(url, init) {
    switch (url.pathname) {
      case '/api/status': return json({ ai: true, youtube: true, accessCode: false });
      case '/api/course': return courseApi(init);
      case '/api/videos': return videosApi(url);
      case '/api/photos': return photosApi(url);
      case '/api/music': return musicApi(url);
      case '/api/podcasts': return podcastsApi(url);
      default: return json({ error: 'not_found' }, 404);
    }
  }
  window.fetch = function (input, init) {
    let url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch (e) { return realFetch(input, init); }
    if (url.origin !== location.origin || url.pathname.indexOf('/api/') !== 0) return realFetch(input, init);
    const signal = init && init.signal;
    if (signal && signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return Promise.resolve().then(() => api(url, init || {}));
  };

  /* ---------- one ready course: other topics get a short explanation ---------- */
  document.addEventListener('submit', e => {
    const form = e.target;
    if (!form || form.id !== 'askForm') return;
    const input = document.getElementById('topic');
    const v = input ? input.value.trim() : '';
    if (!v || isTopic(v)) return; /* app.js takes it from here */
    e.preventDefault();
    e.stopImmediatePropagation();
    const m = document.getElementById('formMsg');
    if (!m) return;
    m.innerHTML = 'בדוגמה הזו יש קורס מוכן אחד, על חורים שחורים. באתר המלא, Claude כותב קורס כזה על כל נושא. '
      + '<button class="txtbtn" type="button" id="pvTry">לקורס על חורים שחורים</button>';
    m.hidden = false;
  }, true);
  document.addEventListener('click', e => {
    if (!e.target.closest || !e.target.closest('#pvTry')) return;
    const input = document.getElementById('topic'), form = document.getElementById('askForm');
    if (!input || !form) return;
    input.value = TOPIC;
    if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('topic');
    if (input && !input.value) input.value = TOPIC;
  });
})();
