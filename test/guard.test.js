import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readCourseRequest, accessAllowed, rateLimited, resetRateLimit, clientIp } from '../lib/guard.js';
import { clean } from '../lib/http.js';

const post = (body, headers = {}) => new Request('http://localhost/api/course', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

beforeEach(() => {
  resetRateLimit();
  delete process.env.ACCESS_CODE;
  delete process.env.RATE_LIMIT_PER_10_MIN;
});

test('a valid course request is read and cleaned', async () => {
  const r = await readCourseRequest(post({ part: 'a', topic: '  חורים‮   שחורים ', minutes: 10, level: 'kids', extra: 'ignored' }));
  assert.deepEqual(r, { ok: true, value: { part: 'a', topic: 'חורים שחורים', minutes: 10, level: 'kids' } });
});

test('bad course requests are turned down', async () => {
  const bad = [
    'not json',
    JSON.stringify([1, 2]),
    { part: 'd', topic: 'x', minutes: 10, level: 'all' },
    { part: 'a', topic: '   ', minutes: 10, level: 'all' },
    { part: 'a', topic: 'x', minutes: 7, level: 'all' },
    { part: 'a', topic: 'x', minutes: 10, level: 'experts' },
    { part: 'a', topic: 'x'.repeat(5000), minutes: 10, level: 'all' },
  ];
  for (const b of bad) assert.deepEqual(await readCourseRequest(post(b)), { ok: false, error: 'bad_request' }, JSON.stringify(b).slice(0, 60));
});

test('a long topic is cut to 120 characters', async () => {
  const r = await readCourseRequest(post({ part: 'b', topic: 'א'.repeat(300), minutes: 5, level: 'all' }));
  assert.equal(r.value.topic.length, 120);
});

test('clean removes control and direction characters', () => {
  assert.equal(clean('a\u0000b‏c⁦d\n\te'), 'a b c d e');
  assert.equal(clean(null), '');
});

test('no access code set: everyone may build', () => {
  assert.equal(accessAllowed(post({})), true);
});

test('access code: only the right one passes, in any language', () => {
  process.env.ACCESS_CODE = 'סקרן-2026';
  assert.equal(accessAllowed(post({})), false);
  assert.equal(accessAllowed(post({}, { 'x-access-code': 'wrong' })), false);
  assert.equal(accessAllowed(post({}, { 'x-access-code': encodeURIComponent('סקרן-2027') })), false);
  assert.equal(accessAllowed(post({}, { 'x-access-code': '%E0%A4%A' })), false);
  assert.equal(accessAllowed(post({}, { 'x-access-code': encodeURIComponent('סקרן-2026') })), true);
});

test('rate limit counts per visitor and per bucket', () => {
  process.env.RATE_LIMIT_PER_10_MIN = '3';
  const a = post({}, { 'x-real-ip': '1.1.1.1' });
  const b = post({}, { 'x-forwarded-for': '2.2.2.2, 10.0.0.1' });
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rateLimited(a, { now }), false);
  assert.equal(rateLimited(a, { now }), true);
  assert.equal(rateLimited(b, { now }), false, 'another visitor is not affected');
  assert.equal(rateLimited(a, { bucket: 'code', limit: 1, now }), false, 'a separate bucket');
  assert.equal(rateLimited(a, { bucket: 'code', limit: 1, now }), true);
  assert.equal(rateLimited(a, { now: now + 10 * 60 * 1000 + 1 }), false, 'the window moves on');
  assert.equal(clientIp(b), '2.2.2.2');
});
