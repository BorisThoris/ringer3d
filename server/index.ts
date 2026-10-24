/**
 * One process for the whole online game: serves the built client from
 * `dist/` and runs the lobby on `/lobby`.
 *
 *   npm run build && npm run serve     # PORT=8787 by default
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { attachLobby } from './lobby.ts';

const PORT = Number(process.env.PORT ?? 8787);
const ROOT = resolve(process.env.STATIC_DIR ?? 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, ...lobby.stats() }));
    return;
  }
  // Resolve inside ROOT only; anything else is a 404.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(404).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(ROOT, 'index.html');
  }
  try {
    const body = await readFile(file);
    const hashed = /assets[\\/]/.test(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const lobby = attachLobby(server);
server.listen(PORT, () => console.log(`ringer3d: http://localhost:${PORT}  lobby ws://localhost:${PORT}/lobby`));
