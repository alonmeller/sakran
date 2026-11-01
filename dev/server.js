// Local server for development: serves public/ and runs the files in api/ the way Vercel does.
//   npm run dev   ->   http://localhost:3000
// Settings (keys) are read from a .env file next to package.json, if there is one.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
loadEnv(path.join(root, '.env'));

const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const pageHeaders = Object.fromEntries(((vercel.headers || [])[0] || { headers: [] }).headers.map(h => [h.key, h.value]));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function api(req, res, url) {
  const name = url.pathname.slice('/api/'.length).replace(/\/$/, '');
  if (!/^[a-z0-9-]+$/.test(name)) { res.writeHead(404); return res.end(); }
  const file = path.join(root, 'api', name + '.js');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const mod = await import(pathToFileURL(file).href);
  const fn = mod[req.method];
  if (typeof fn !== 'function') { res.writeHead(405); return res.end(); }
  const stop = new AbortController();
  res.on('close', () => { if (!res.writableFinished) stop.abort(); });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) for (const x of [].concat(v)) headers.append(k, x);
  if (!headers.has('x-real-ip')) headers.set('x-real-ip', req.socket.remoteAddress || 'local');
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
  const request = new Request(new URL(req.url, 'http://' + (req.headers.host || 'localhost')), { method: req.method, headers, body, signal: stop.signal });
  let response;
  try { response = await fn(request); } catch (e) { console.error(e); res.writeHead(500); return res.end(); }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (!response.body) return res.end();
  try { for await (const chunk of response.body) res.write(chunk); } catch { /* client left */ }
  res.end();
}

function page(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(pub, rel));
  if (!file.startsWith(pub + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('לא נמצא');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache', ...pageHeaders });
  fs.createReadStream(file).pipe(res);
}

const port = Number(process.env.PORT || 3000);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  (url.pathname.startsWith('/api/') ? api(req, res, url) : Promise.resolve(page(req, res, url))).catch(e => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
}).listen(port, () => console.log('סקרן פועל: http://localhost:' + port));
