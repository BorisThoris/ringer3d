// Headless close-ups of surface flaws and wear: clear glass Mint and Chipped, a steelie, a clay
// marble, a Flawless one, seed bubbles and a stone, each with its own wear on top.
// Build first (npx vite build --config packages/marble-forge/vite.config.ts).
//   node packages/marble-forge/scripts/qa-flaws.mjs      (OUT_DIR, CHROME_PATH optional)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const here = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.OUT_DIR ?? 'e2e-out/flaws';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });

const server = await preview({ configFile: `${here}vite.config.ts`, preview: { port: 4192, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${OUT}/profile`],
});
const report = { errors: [], shots: {} };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 820 });
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && report.errors.push(m.text()));
  await page.goto('http://127.0.0.1:4192/', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 3000));
  // Find one marble of each kind by rolling; the facts panel says its wear and its surface.
  // A previous report in OUT_DIR is reused, so a rerun shows the same marbles.
  const prev = existsSync(`${OUT}/report.json`) ? JSON.parse(readFileSync(`${OUT}/report.json`, 'utf8')).shots : null;
  const picks = prev && Object.keys(prev).length ? prev : await page.evaluate(() => {
    const want = {
      'clear-chipped': (m, f) => ['clearie', 'catseye', 'swirl'].includes(m.pattern) && /Chipped/.test(f) && /pit/.test(f),
      'clear-mint': (m, f) => ['clearie', 'catseye'].includes(m.pattern) && /Mint|Polished/.test(f) && /seam/.test(f) && /fingerprints/.test(f),
      'seeds-stone': (m, f) => ['clearie', 'catseye', 'swirl'].includes(m.pattern) && /seed bubbles/.test(f) && /stone/.test(f),
      steelie: (m, f) => m.pattern === 'steelie' && /heavy orange peel/.test(f) && /Scuffed|Chipped/.test(f),
      clay: (m, f) => m.pattern === 'solid' && /pits/.test(f),
      flawless: (m, f) => m.pattern !== 'solid' && m.pattern !== 'steelie' && /Flawless/.test(f) && /Mint|Polished/.test(f),
    };
    const out = {};
    for (let i = 0; i < 6000 && Object.keys(out).length < Object.keys(want).length; i++) {
      const tier = ['Common', 'Rare', 'Rare', 'Epic'][i % 4];
      const uid = window.forge.roll({ tier });
      window.forge.show(uid);
      const facts = document.getElementById('facts').innerText.replace(/\s+/g, ' ');
      const m = window.forge.resolve(uid).marble;
      for (const [k, ok] of Object.entries(want)) if (!out[k] && ok(m, facts)) out[k] = { uid, name: m.name, pattern: m.pattern, facts };
    }
    return out;
  });
  report.shots = picks;
  for (const [k, p] of Object.entries(picks)) {
    const b64 = await page.evaluate((u) => window.forge.png(u, { size: 1024, time: 1.5, background: '#3a4150' }), p.uid);
    writeFileSync(`${OUT}/${k}.png`, Buffer.from(b64, 'base64'));
  }
  writeFileSync(`${OUT}/model.glb`, Buffer.from(await page.evaluate((u) => window.forge.glb(u), Object.values(picks)[0].uid), 'base64'));
  await page.screenshot({ path: `${OUT}/forge-page.png` });
} catch (e) {
  report.failure = String(e?.message ?? e);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
  server.httpServer.close();
}
