// GET /api/status  ->  which parts of the app are set up on this server (never the keys themselves).
// With an x-access-code header it also says whether that code is right.
import { json } from '../lib/http.js';
import { configured } from '../lib/claude.js';
import { accessAllowed, rateLimited } from '../lib/guard.js';

export function GET(request) {
  const out = {
    ai: configured(),
    youtube: !!process.env.YOUTUBE_API_KEY,
    accessCode: !!process.env.ACCESS_CODE,
  };
  if (out.accessCode && request.headers.has('x-access-code')) {
    if (rateLimited(request, { bucket: 'code', limit: 20 })) out.error = 'rate_limited';
    else out.codeOk = accessAllowed(request);
  }
  return json(out);
}
