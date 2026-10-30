// Headless close-ups of glass bodies (body.ts): clear, hazy, milk and opal glass, puffs,
// wisps and thick clouds, coloured clouds, and a phenomenon behind light clouds.
// Build first (npx vite build --config packages/marble-forge/vite.config.ts).
//   node packages/marble-forge/scripts/qa-glass.mjs      (OUT_DIR, CHROME_PATH optional)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const here = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.OUT_DIR ?? 'e2e-out/glass';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });

const server = await preview({ configFile: `${here}vite.config.ts`, preview: { port: 4193, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
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
  await page.goto('http://127.0.0.1:4193/', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 3000));
  // Find one marble of each kind by rolling; the facts panel says its wear and its surface.
  // A previous report in OUT_DIR is reused, so a rerun shows the same marbles.
  const prev = existsSync(`${OUT}/report.json`) ? JSON.parse(readFileSync(`${OUT}/report.json`, 'utf8')).shots : null;
  const picks = prev && Object.keys(prev).length ? prev : await page.evaluate(() => {
    const see = (m) => !['solid', 'steelie'].includes(m.pattern);
    const want = {
      clear: (m, f) => see(m) && /Glass clear glass Surface/.test(f),
      hazy: (m, f) => see(m) && /hazy glass, little clouds/.test(f),
      milk: (m, f) => see(m) && /milk glass/.test(f) && !/clouds|wisps/.test(f),
      opal: (m, f) => see(m) && /opal glass/.test(f),
      wisps: (m, f) => see(m) && /clear glass, (thick )?(coloured )?wisps/.test(f),
      thick: (m, f) => see(m) && /thick little clouds/.test(f),
      big: (m, f) => see(m) && /big clouds/.test(f),
      coloured: (m, f) => see(m) && /coloured (little|big) clouds/.test(f),
      phenomenon: (m, f) => m.effect !== 'none' && /clouds|wisps/.test(f),
    };
    const out = {};
    for (let i = 0; i < 6000 && Object.keys(out).length < Object.keys(want).length; i++) {
      const tier = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'][i % 5];
      const uid = window.forge.roll({ tier });
      window.forge.show(uid);
      const facts = document.getElementById('facts').innerText.replace(/\s+/g, ' ');
      const m = window.forge.resolve(uid).marble;
      for (const [k, ok] of Object.entries(want)) if (!out[k] && ok(m, facts)) {
        out[k] = { uid, name: m.name, pattern: m.pattern, facts };
        break;
      }
    }
    return out;
  });
  report.shots = picks;
  for (const [k, p] of Object.entries(picks)) {
    const b64 = await page.evaluate((u) => window.forge.png(u, { size: 640, time: 1.5, background: '#3a4150' }), p.uid);
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
