// Does a build actually fetch and decode its music? Serves <distDir>, clicks
// through to a quick match (the click unlocks audio), and reports which
// music files loaded and whether the music bus is playing.
//   node scripts/probe-music.mjs <distDir> <outDir>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { launch, logger } from './lib.mjs';

const [dist, out] = process.argv.slice(2);
const say = logger(out);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
  try {
    const body = await readFile(join(dist, p));
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(5191);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
page.setDefaultTimeout(180000);
const music = [];
page.on('response', (r) => r.url().includes('/music/') && music.push(`${r.status()} ${r.url().split('/').pop()}`));
page.on('pageerror', (e) => say('pageerror', e.message));
await page.goto('http://localhost:5191/');
await page.waitForTimeout(8000);
await page.mouse.click(500, 650); // a gesture anywhere unlocks audio
await page.waitForTimeout(4000);
say('after unlock', music);
for (const name of [/^quick/i, /^play/i]) {
  const b = page.getByRole('button', { name }).first();
  if (await b.count()) await b.evaluate((el) => el.click());
  await page.waitForTimeout(12000);
}
say('after starting a match', music);
await page.screenshot({ path: join(out, 'match.png') });
await browser.close();
server.close();
