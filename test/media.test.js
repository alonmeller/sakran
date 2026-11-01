import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities, stripHtml, normalize, sameTitle, sameName, parseDuration,
  mapYouTube, pickFiles, mapImageInfo, matchSong, matchShow, mapEpisodes,
} from '../lib/media.js';
import { youtubeSearch, youtubeVideos, mediaList, imageInfo, itunesSongs, itunesShows, itunesEpisodes } from './mocks.js';

test('text helpers', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#39;s &#x41; &bogus;'), "Tom & Jerry 's A &bogus;");
  assert.equal(stripHtml('<a href="x">EHT</a> <b>team</b>'), 'EHT team');
  assert.equal(normalize('Beyoncé – Halo!'), 'beyonce halo');
  assert.equal(normalize('נאס״א'), 'נאסא');
  assert.equal(normalize('שָׁלוֹם'), 'שלום');
  assert.ok(sameTitle('Supermassive Black Hole - Remastered 2011', 'supermassive black hole'));
  assert.ok(sameTitle('Black Hole Sun (feat. X)', 'Black Hole Sun'));
  assert.ok(!sameTitle('Black', 'Black Hole Sun'));
  assert.ok(sameName('The Beatles', 'Beatles'));
  assert.ok(!sameName('Muse', 'Museum Choir'));
});

test('YouTube durations', () => {
  assert.equal(parseDuration('PT6M29S'), 389);
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  assert.equal(parseDuration('P1DT1S'), 86401);
  assert.equal(parseDuration('nonsense'), 0);
});

test('YouTube results: no live, no blocked embeds, sensible length, titles decoded', () => {
  const v = mapYouTube(youtubeSearch, youtubeVideos, 4);
  assert.deepEqual(v.map(x => x.id), ['vid_AAAAAA1', 'vid_HEB0001']);
  assert.equal(v[0].title, 'Black Holes Explained – From Birth to Death');
  assert.equal(v[0].channel, 'Kurzgesagt & Friends');
  assert.equal(v[0].duration, 389);
  assert.equal(v[1].title, "חורים שחורים 'בקצרה'");
  assert.deepEqual(mapYouTube(null, null), []);
});

test('Wikipedia media list: photos only, no logos or videos', () => {
  assert.deepEqual(pickFiles(mediaList, 10), [
    'File:Black_hole_-_Messier_87_crop_max_res.jpg',
    'File:Sagittarius_A*_black_hole.jpg',
    'File:Tiny_diagram.png',
    'File:Fair_use_poster.jpg',
  ]);
  assert.equal(pickFiles(mediaList, 1).length, 1);
});

test('image info: free licenses and large enough photos only, in page order, with credits', () => {
  const order = pickFiles(mediaList, 10);
  const p = mapImageInfo(imageInfo, order, 4);
  assert.deepEqual(p.map(x => x.title), ['File:Black_hole_-_Messier_87_crop_max_res.jpg', 'File:Sagittarius_A*_black_hole.jpg']);
  assert.equal(p[0].src, 'https://upload.wikimedia.org/a/960px-m87.jpg');
  assert.equal(p[0].license, 'CC BY 4.0');
  assert.equal(p[1].author, 'EHT Collaboration');
  assert.equal(p[0].page, 'https://commons.wikimedia.org/wiki/File:M87');
});

test('image info: an address outside Wikimedia is never used', () => {
  const evil = { query: { pages: [{ title: 'File:X.jpg', imageinfo: [{ url: 'https://evil.example/x.jpg', width: 1000, height: 800, mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'CC0' } } }] }] } };
  assert.deepEqual(mapImageInfo(evil), []);
});

test('songs: the right one is matched, with a bigger cover and a preview', () => {
  const s = matchSong(itunesSongs.results, 'Supermassive Black Hole', 'Muse');
  assert.equal(s.artist, 'Muse');
  assert.equal(s.year, '2006');
  assert.equal(s.artwork, 'https://is1-ssl.mzstatic.com/image/thumb/a/300x300bb.jpg');
  assert.equal(s.preview, 'https://audio-ssl.itunes.apple.com/p/preview.m4a');
  assert.equal(matchSong(itunesSongs.results, 'Invented Song', 'Muse'), null);
  const live = [{ kind: 'song', trackName: 'Supermassive Black Hole (Live)', artistName: 'Muse', previewUrl: 'https://a/live.m4a' }, ...itunesSongs.results];
  assert.equal(matchSong(live, 'Supermassive Black Hole', 'Muse').preview, 'https://audio-ssl.itunes.apple.com/p/preview.m4a', 'the studio recording wins');
  assert.equal(matchSong([{ kind: 'song', trackName: 'Black Hole Sun', artistName: 'Karaoke Hits Band' }], 'Black Hole Sun', ''), null, 'no karaoke copies');
  assert.equal(matchSong(itunesSongs.results, 'Supermassive Black Hole', 'Coldplay'), null);
});

test('podcast shows and episodes', () => {
  const show = matchShow(itunesShows.results, 'StarTalk');
  assert.equal(show.name, 'StarTalk Radio');
  assert.equal(matchShow(itunesShows.results, 'Invented Podcast'), null);
  const eps = mapEpisodes(itunesEpisodes.results, 3);
  assert.deepEqual(eps.map(e => e.audio), ['https://cdn.example.com/ep1.mp3', 'https://cdn.example.com/he.mp3']);
  assert.equal(eps[0].duration, 2700);
});
