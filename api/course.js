// POST /api/course  { part: "a" | "b" | "c", topic, minutes, level }
// Streams one part of a course from Claude as JSON Lines, exactly as the model writes them.
// A problem after the stream has started arrives as a last line {"t":"error","code":"..."}.
import {
  anthropic, model, configured, errorCode,
  FALLBACK_BETA, fallbacksWanted, disableFallbacks, isFallbackRejection,
} from '../lib/claude.js';
import { buildPrompt } from '../lib/prompts.js';
import { readCourseRequest, accessAllowed, rateLimited } from '../lib/guard.js';
import { json } from '../lib/http.js';

const PART = {
  a: { effort: 'medium', maxTokens: 32000 }, // the feed and the quiz: accuracy matters most
  b: { effort: 'medium', maxTokens: 16000 }, // the side tiles
  c: { effort: 'low', maxTokens: 16000 },    // three drawings
};

export async function POST(request) {
  if (!configured()) return json({ error: 'not_configured' }, 503);
  const read = await readCourseRequest(request);
  if (!read.ok) return json({ error: read.error }, 400);
  if (rateLimited(request)) return json({ error: 'rate_limited' }, 429);
  if (!accessAllowed(request)) return json({ error: 'access_code' }, 401);

  const { part } = read.value;
  const prompt = buildPrompt(part, read.value);
  const base = {
    model: model(),
    max_tokens: PART[part].maxTokens,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    output_config: { effort: PART[part].effort },
  };

  const stop = new AbortController();
  if (request.signal) request.signal.addEventListener('abort', () => stop.abort(), { once: true });
  const encoder = new TextEncoder();
  const started = Date.now();

  const body = new ReadableStream({
    async start(controller) {
      let sent = false;
      const send = s => { try { controller.enqueue(encoder.encode(s)); } catch { /* reader is gone */ } };
      const fail = code => send('\n' + JSON.stringify({ t: 'error', code }) + '\n');
      const run = async withFallbacks => {
        const params = withFallbacks ? { ...base, betas: [FALLBACK_BETA], fallbacks: 'default' } : base;
        const stream = anthropic().beta.messages.stream(params, { signal: stop.signal });
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
            sent = true;
            send(ev.delta.text);
          }
        }
        return stream.finalMessage();
      };
      try {
        const withFallbacks = fallbacksWanted();
        let msg;
        try {
          msg = await run(withFallbacks);
        } catch (e) {
          if (!withFallbacks || sent || !isFallbackRejection(e)) throw e;
          disableFallbacks();
          console.warn(JSON.stringify({ evt: 'fallbacks_unavailable', part }));
          msg = await run(false);
        }
        if (msg.stop_reason === 'refusal') fail('refused');
        else if (msg.stop_reason === 'max_tokens') fail('truncated');
        const u = msg.usage || {};
        console.log(JSON.stringify({ evt: 'course_part', part, model: msg.model, input: u.input_tokens, output: u.output_tokens, stop: msg.stop_reason, ms: Date.now() - started }));
      } catch (e) {
        if (!stop.signal.aborted) {
          console.error(JSON.stringify({ evt: 'course_part_error', part, status: e && e.status, name: e && e.constructor && e.constructor.name }));
          fail(errorCode(e));
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
    cancel() { stop.abort(); },
  });

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
