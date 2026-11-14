// Render scene dumps (preview.mjs) to PNGs with three.js in headless Chromium. Run it inside the
// isolated window station (D:\gha-runners\headless-tools\Start-IsolatedProcess.ps1).
//   node roblox/scripts/preview/render.mjs <outDir> [scene ...]
import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import puppeteer from 'puppeteer-core';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const [outDir, ...asked] = process.argv.slice(2);
const scenes = asked.length ? asked : readdirSync(outDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

// Cameras, relative to the scene's origin: [name, position, look-at, fov].
const B = 52; // Config.BOUND_R in studs
const FIELD = [
  ['seat', [0, 34, B + 46], [0, 0, 0], 62],
  ['wide', [120, 80, 120], [0, 0, 0], 60],
  ['out-n', [0, 14, 0], [0, 6, -500], 75],
  ['out-e', [0, 14, 0], [500, 6, 0], 75],
  ['out-s', [0, 14, 0], [0, 6, 500], 75],
  ['out-w', [0, 14, 0], [-500, 6, 0], 75],
  ['aerial', [0, 520, 420], [0, 0, 0], 55],
];
const LOBBY = [
  ['spawn', [0, 7, 46], [0, 8, 0], 70],
  ['aerial', [220, 200, 280], [0, 0, 0], 55],
  ['out-n', [0, 10, 0], [0, 10, -400], 75],
  ['out-e', [0, 10, 0], [400, 10, 0], 75],
  ['out-s', [0, 10, 0], [0, 10, 400], 75],
  ['out-w', [0, 10, 0], [-400, 10, 0], 75],
  ['race-gate', [20, 14, -40], [55, 12, -100], 65],
];
function camerasFor(scene, dump) {
  if (scene === 'lobby') return LOBBY;
  if (dump.cameras) return dump.cameras; // race scenes bring their own
  return FIELD;
}

let current = null;
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = null;
  if (url === '/' || url === '/index.html') file = join(here, 'page.html');
  else if (url === '/dump.json') file = current;
  else if (url.startsWith('/three/')) file = join(repo, 'node_modules', 'three', url.slice('/three/'.length));
  if (!file || !existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }[extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const exe = join(homedir(), 'AppData', 'Local', 'ms-playwright', 'chromium_headless_shell-1243', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--no-first-run'],
  defaultViewport: { width: 1280, height: 720 },
  timeout: 180000, // a busy PC can take a while to start the browser
  protocolTimeout: 600000,
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('page error:', m.text()); });
page.on('pageerror', (e) => console.log('page exception:', e.message));
for (const scene of scenes) {
  current = join(outDir, `${scene}.json`);
  const dump = JSON.parse(readFileSync(current, 'utf8'));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForFunction('window.ready === true', { timeout: 120000 });
  const stats = await page.evaluate('window.stats');
  for (const [name, pos, look, fov] of camerasFor(scene, dump)) {
    await page.evaluate((p, l, f) => window.view(p, l, f), pos, look, fov);
    await page.screenshot({ path: join(outDir, `${scene}-${name}.png`) });
  }
  console.log(`${scene}: ${stats.parts} parts, ${stats.terrain} terrain columns rendered`);
}
await browser.close();
server.close();
