// The Claude client and how its errors are reported to the page.
import Anthropic from '@anthropic-ai/sdk';

let client = null;
/** One client per server instance. Reads ANTHROPIC_API_KEY from the environment. */
export const anthropic = () => (client ||= new Anthropic());

/** The model to use comes from the CLAUDE_MODEL setting (see the README). */
export const model = () => (process.env.CLAUDE_MODEL || '').trim();

/** Both settings the course API needs. */
export const configured = () => !!process.env.ANTHROPIC_API_KEY && !!model();

/*
 * Refusal fallback: when a safety check declines a request, the API runs it again,
 * in the same call, on the model Anthropic recommends for that case.
 * On unless CLAUDE_FALLBACKS=off. If the chosen model does not offer it, the first
 * request is turned down with a message about it, and this server instance stops asking.
 */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
let fallbacksOn = null;
export function fallbacksWanted() {
  if (fallbacksOn === null) fallbacksOn = (process.env.CLAUDE_FALLBACKS || '').trim().toLowerCase() !== 'off';
  return fallbacksOn;
}
export function disableFallbacks() { fallbacksOn = false; }
export function resetFallbacks() { fallbacksOn = null; }
export const isFallbackRejection = e => e instanceof Anthropic.BadRequestError && /fallback/i.test(String((e && e.message) || ''));

/** A short code the page knows how to explain. */
export function errorCode(e) {
  if (e instanceof Anthropic.RateLimitError) return 'rate_limited';
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'not_configured';
  if (e instanceof Anthropic.NotFoundError) return 'not_configured';
  if (e instanceof Anthropic.BadRequestError) return 'bad_request';
  if (e instanceof Anthropic.APIConnectionError) return 'upstream_error';
  if (e instanceof Anthropic.APIError) return (e.status === 529 || (e.status || 0) >= 500) ? 'overloaded' : 'upstream_error';
  return 'upstream_error';
}
