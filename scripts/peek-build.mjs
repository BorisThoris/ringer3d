// Screenshot any built copy of the game (e.g. another branch's dist) for a
// side-by-side look: home screen, then whatever "play" button it offers.
//   node scripts/peek-build.mjs <distDir> <outDir>
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { launch, logger } from './lib.mjs';

const [dist, out] = process.argv.slice(2);
const say = logger(out);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '') || 'index.html';
  try {
    res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
    res.end(await readFile(join(dist, p)));
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(join(dist, 'index.html')));
  }
}).listen(5190);
const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.setDefaultTimeout(180000);
page.on('pageerror', (e) => say('pageerror', e.message));
await page.goto('http://localhost:5190/');
await page.waitForTimeout(12000);
await page.screenshot({ path: join(out, '01-home.png') });
const buttons = await page.locator('button').allInnerTexts();
say('buttons', buttons.map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean));
// Walk into a match: the first play-like button, then again for any setup screen.
for (let step = 2; step <= 5; step++) {
  const b = page.getByRole('button', { name: /^(play|quick|versus|vs|start|fight|go)\b/i }).first();
  if (!(await b.count())) break;
  say('click', (await b.innerText()).replace(/\s+/g, ' ').trim());
  await b.evaluate((el) => el.click());
  await page.waitForTimeout(15000);
  await page.screenshot({ path: join(out, `0${step}-step.png`) });
}
await browser.close();
server.close();
