// Input checks, an optional access code, and a simple rate limit for the course API.
import { clean } from './http.js';

export const MINUTES = [5, 10, 15, 30];
export const LEVELS = ['all', 'kids', 'beginner', 'advanced'];
export const PARTS = ['a', 'b', 'c'];

/**
 * Read and check the body of a course request.
 * Returns { ok: true, value } or { ok: false, error }.
 */
export async function readCourseRequest(request) {
  let text = '';
  try { text = await request.text(); } catch { return { ok: false, error: 'bad_request' }; }
  if (text.length > 4000) return { ok: false, error: 'bad_request' };
  let body;
  try { body = JSON.parse(text); } catch { return { ok: false, error: 'bad_request' }; }
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_request' };
  const part = String(body.part || '');
  const topic = clean(body.topic, 120);
  const minutes = Number(body.minutes);
  const level = String(body.level || 'all');
  if (!PARTS.includes(part)) return { ok: false, error: 'bad_request' };
  if (!topic) return { ok: false, error: 'bad_request' };
  if (!MINUTES.includes(minutes)) return { ok: false, error: 'bad_request' };
  if (!LEVELS.includes(level)) return { ok: false, error: 'bad_request' };
  return { ok: true, value: { part, topic, minutes, level } };
}

/** When ACCESS_CODE is set, only requests that send it may build courses. */
export function accessAllowed(request) {
  const code = process.env.ACCESS_CODE;
  if (!code) return true;
  let sent = request.headers.get('x-access-code') || '';
  try { sent = decodeURIComponent(sent); } catch { return false; } // the page sends it URL-encoded, so any letters work
  if (sent.length !== code.length) return false;
  let diff = 0;
  for (let i = 0; i < code.length; i++) diff |= code.charCodeAt(i) ^ sent.charCodeAt(i);
  return diff === 0;
}

export function clientIp(request) {
  const h = request.headers;
  const ip = h.get('x-real-ip') || (h.get('x-forwarded-for') || '').split(',')[0];
  return (ip || 'unknown').trim();
}

/*
 * Rate limit, counted per visitor address in this server instance.
 * It slows down a single heavy user; it is not a full protection on its own
 * (Vercel may run several instances). Set a monthly spend limit in the Anthropic Console too.
 */
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map();

/**
 * True when this visitor made too many requests in the last 10 minutes.
 * A course is three requests (its three parts), so the default of 30 allows about 10 courses.
 * `bucket` keeps separate counts, for example for checking the access code.
 */
export function rateLimited(request, { bucket = 'course', limit, now = Date.now() } = {}) {
  const max = Number(limit ?? (process.env.RATE_LIMIT_PER_10_MIN || 30));
  if (!(max > 0)) return false;
  const key = bucket + ':' + clientIp(request);
  const recent = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= max) { hits.set(key, recent); return true; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  }
  return false;
}

export function resetRateLimit() { hits.clear(); }
