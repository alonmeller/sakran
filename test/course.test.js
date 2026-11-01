// The course API against a stand-in for the Claude API.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startMock, sse, messageEvents, apiError } from './mocks.js';

const LINES = [
  '{"t":"meta","title":"חורים שחורים","en":"Black hole","hook":"כבידה שמנצחת את האור."}',
  '{"t":"chapter","title":"מה זה","body":["פסקה ==חשובה==."]}',
].join('\n') + '\n';

let mock, reply;
let POST, GET, resetRateLimit, resetFallbacks;

before(async () => {
  mock = await startMock((call, res) => reply(call, res));
  // Set before the first request: the Claude client reads these once.
  process.env.ANTHROPIC_BASE_URL = mock.url;
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  ({ POST } = await import('../api/course.js'));
  ({ GET } = await import('../api/status.js'));
  ({ resetRateLimit } = await import('../lib/guard.js'));
  ({ resetFallbacks } = await import('../lib/claude.js'));
});
after(() => mock.close());
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.CLAUDE_MODEL = 'test-model';
  delete process.env.ACCESS_CODE;
  delete process.env.CLAUDE_FALLBACKS;
  delete process.env.RATE_LIMIT_PER_10_MIN;
  mock.calls.length = 0;
  resetRateLimit();
  resetFallbacks();
  reply = (call, res) => sse(res, messageEvents(LINES));
});

const ask = (body, headers = {}) => POST(new Request('http://localhost/api/course', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-real-ip': '9.9.9.9', ...headers },
  body: JSON.stringify({ part: 'a', topic: 'חורים שחורים', minutes: 10, level: 'all', ...body }),
}));
const lastLine = text => JSON.parse(text.trim().split('\n').pop());

test('streams the model text as it is, and asks Claude the right way', async () => {
  const res = await ask({});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(await res.text(), LINES);

  assert.equal(mock.calls.length, 1);
  const call = mock.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(call.path, '/v1/messages');
  assert.equal(call.headers.authorization, 'Bearer test-key');
  assert.equal(call.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  const b = call.body;
  assert.equal(b.model, 'test-model');
  assert.equal(b.stream, true);
  assert.equal(b.fallbacks, 'default');
  assert.deepEqual(b.output_config, { effort: 'medium' });
  assert.equal(b.max_tokens, 32000);
  assert.equal(b.thinking, undefined, 'thinking is left to the model');
  assert.equal(b.betas, undefined, 'betas go in the header, not the body');
  assert.match(b.system, /JSON Lines only/);
  assert.equal(b.messages.length, 1);
  assert.match(b.messages[0].content, /«חורים שחורים»/);
});

test('the illustrations part asks for less effort', async () => {
  await (await ask({ part: 'c' })).text();
  assert.deepEqual(mock.calls[0].body.output_config, { effort: 'low' });
});

test('a refusal ends with an error line', async () => {
  reply = (call, res) => sse(res, messageEvents('', { stop: 'refusal' }));
  const text = await (await ask({})).text();
  assert.deepEqual(lastLine(text), { t: 'error', code: 'refused' });
});

test('an answer cut by the token limit says so', async () => {
  reply = (call, res) => sse(res, messageEvents(LINES, { stop: 'max_tokens' }));
  const text = await (await ask({})).text();
  assert.ok(text.startsWith(LINES));
  assert.deepEqual(lastLine(text), { t: 'error', code: 'truncated' });
});

test('API errors become short codes the page can explain', async () => {
  const cases = [
    [429, 'rate_limit_error', 'rate_limited'],
    [529, 'overloaded_error', 'overloaded'],
    [401, 'authentication_error', 'not_configured'],
    [404, 'not_found_error', 'not_configured'],
    [400, 'invalid_request_error', 'bad_request'],
  ];
  process.env.CLAUDE_FALLBACKS = 'off';
  for (const [status, type, code] of cases) {
    reply = (call, res) => apiError(res, status, type, 'test error');
    const text = await (await ask({})).text();
    assert.deepEqual(lastLine(text), { t: 'error', code }, String(status));
  }
});

test('a model without refusal fallback: asks once more without it, then stops asking', async () => {
  reply = (call, res) => (call.body.fallbacks
    ? apiError(res, 400, 'invalid_request_error', 'fallbacks: not supported for this model')
    : sse(res, messageEvents(LINES)));
  assert.equal(await (await ask({})).text(), LINES);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[1].body.fallbacks, undefined);
  assert.equal(mock.calls[1].headers['anthropic-beta'], undefined);
  await (await ask({ part: 'b' })).text();
  assert.equal(mock.calls.length, 3, 'no extra request the next time');
  assert.equal(mock.calls[2].body.fallbacks, undefined);
});

test('another bad request is not retried', async () => {
  reply = (call, res) => apiError(res, 400, 'invalid_request_error', 'max_tokens: too large');
  const text = await (await ask({})).text();
  assert.deepEqual(lastLine(text), { t: 'error', code: 'bad_request' });
  assert.equal(mock.calls.length, 1);
});

test('CLAUDE_FALLBACKS=off leaves the fallback out', async () => {
  process.env.CLAUDE_FALLBACKS = 'off';
  await (await ask({})).text();
  assert.equal(mock.calls[0].body.fallbacks, undefined);
  assert.equal(mock.calls[0].headers['anthropic-beta'], undefined);
});

test('checks before calling Claude', async () => {
  delete process.env.CLAUDE_MODEL;
  let res = await ask({});
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'not_configured' });
  process.env.CLAUDE_MODEL = 'test-model';

  res = await ask({ minutes: 11 });
  assert.equal(res.status, 400);

  process.env.ACCESS_CODE = 'קוד';
  res = await ask({});
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'access_code' });
  res = await ask({}, { 'x-access-code': encodeURIComponent('קוד') });
  assert.equal(res.status, 200);
  await res.text();

  delete process.env.ACCESS_CODE;
  process.env.RATE_LIMIT_PER_10_MIN = '2';
  resetRateLimit();
  await (await ask({})).text();
  await (await ask({})).text();
  res = await ask({});
  assert.equal(res.status, 429);
  assert.equal(mock.calls.filter(c => c.path === '/v1/messages').length, 3, 'turned-down requests never reach Claude');
});

test('leaving the page stops the request to Claude', async () => {
  let closed;
  const gone = new Promise(r => { closed = r; });
  reply = async (call, res) => {
    res.on('close', closed);
    await sse(res, messageEvents(LINES.repeat(200), { chunk: 20 }), { delay: 5 });
  };
  const stop = new AbortController();
  const res = await POST(new Request('http://localhost/api/course', {
    method: 'POST', signal: stop.signal, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ part: 'a', topic: 'x', minutes: 5, level: 'all' }),
  }));
  const reader = res.body.getReader();
  await reader.read();
  stop.abort();
  await reader.cancel();
  await gone;
});

test('status says what is set up, never the keys', async () => {
  let s = await (await GET(new Request('http://localhost/api/status'))).json();
  assert.deepEqual(s, { ai: true, youtube: false, accessCode: false });
  assert.ok(!JSON.stringify(s).includes('test-key'));

  process.env.ACCESS_CODE = 'abc';
  s = await (await GET(new Request('http://localhost/api/status', { headers: { 'x-access-code': 'abd' } }))).json();
  assert.equal(s.codeOk, false);
  s = await (await GET(new Request('http://localhost/api/status', { headers: { 'x-access-code': 'abc' } }))).json();
  assert.equal(s.codeOk, true);
  delete process.env.ANTHROPIC_API_KEY;
  s = await (await GET(new Request('http://localhost/api/status'))).json();
  assert.equal(s.ai, false);
});
