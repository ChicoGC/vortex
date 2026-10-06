/* Zero-dependency static server for web/. Dev convenience only — the site
   itself is plain html/css/js and can also be opened straight from disk. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'web');
const PORT = Number(process.env.PORT) || 4180;

// The security headers vercel.json sends in production (CSP and friends), so they get tested here
// too. HSTS is left out: it means nothing over plain http on localhost.
const vercel = JSON.parse(await readFile(join(ROOT, '..', 'vercel.json'), 'utf8'));
const SECURITY_HEADERS = Object.fromEntries((vercel.headers || []).flatMap((rule) => rule.headers)
  .filter((h) => h.key !== 'Strict-Transport-Security').map((h) => [h.key, h.value]));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');  // a malformed %-escape would otherwise crash the server
    return;
  }
  if (rel.endsWith('/')) rel += 'index.html';
  // Mirrors the rewrites in vercel.json: the Spotify OAuth redirect lands on the app, /privacy on the policy.
  if (rel === '/callback') rel = '/index.html';
  if (rel === '/privacy') rel = '/privacy.html';
  if (rel === '/privacidade') rel = '/privacidade.html';

  const path = join(ROOT, normalize(rel));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(path);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'cache-control': 'no-store'
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => console.log(`vortex web → http://localhost:${PORT}`));
