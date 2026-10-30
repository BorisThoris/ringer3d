// Headless look at the Forge: the page itself, then one marble of every phenomenon at two
// moments of its animation. Build first (npx vite build --config packages/marble-forge/vite.config.ts).
//   node packages/marble-forge/scripts/qa-forge.mjs      (OUT_DIR, CHROME_PATH optional)
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const here = fileURLToPath(new URL('..', import.meta.url));
const OUT = process.env.OUT_DIR ?? 'e2e-out/forge';
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(OUT, { recursive: true });

const server = await preview({ configFile: `${here}vite.config.ts`, preview: { port: 4191, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${OUT}/profile`],
});
const report = { errors: [], effects: {} };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 820 });
  page.on('pageerror', (e) => report.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && report.errors.push(m.text()));
  await page.goto('http://127.0.0.1:4191/', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 4000));
  await page.screenshot({ path: `${OUT}/forge-page.png` });
  // The same marbles every run, so runs compare (a dark onyx, a galaxy, a neon, an onionskin, a
  // neon with glitter, a holo opal, and an Epic neon with no phenomenon).
  const FIXED = {
    aurora: 'cL-F9780013d7c0481b0',
    inferno: 'cL-F09296f6d36aaf2d1',
    void: 'cL-F4e6bdb2c47998e2e',
    storm: 'cL-F580a9cc5d77811e0',
    geode: 'cL-Fae8bbe3f6943219a',
    starfall: 'cL-Fac711cedbad5a390',
    none: 'cE-Fdd141f41c617c3d1',
    'mythic-galaxy': '1:Mythic',
    'mythic-onyx': '2:Mythic',
  };
  for (const [effect, uid] of Object.entries(FIXED)) {
    const info = await page.evaluate((u) => window.forge.resolve(u), uid);
    report.effects[effect] = { uid, name: info.marble.name, pattern: info.marble.pattern, finish: info.marble.finish };
    for (const t of [1.5, 4.2]) {
      const b64 = await page.evaluate((u, time) => window.forge.png(u, { size: 512, time, background: '#0c1120' }), uid, t);
      writeFileSync(`${OUT}/${effect}-${t}.png`, Buffer.from(b64, 'base64'));
    }
  }
  // Every phenomenon in clear glass too (a catseye or clearie), where nothing hides it.
  for (const effect of ['aurora', 'inferno', 'void', 'storm', 'geode', 'starfall']) {
    const uid = await page.evaluate((e) => {
      for (let i = 0; i < 400; i++) {
        const u = window.forge.roll({ tier: 'Mythic', effect: e });
        if (['catseye', 'clearie', 'swirl'].includes(window.forge.resolve(u).marble.pattern)) return u;
      }
      return window.forge.roll({ tier: 'Mythic', effect: e });
    }, effect);
    report.effects[`${effect}-clear`] = { uid, name: (await page.evaluate((u) => window.forge.resolve(u), uid)).marble.name };
    const b64 = await page.evaluate((u) => window.forge.png(u, { size: 512, time: 1.5, background: '#0c1120' }), uid);
    writeFileSync(`${OUT}/clear-${effect}.png`, Buffer.from(b64, 'base64'));
  }
  // A transparent export and a model, to check the matting and the exporter.
  const any = report.effects.inferno.uid;
  writeFileSync(`${OUT}/transparent.png`, Buffer.from(await page.evaluate((u) => window.forge.png(u, { size: 512 }), any), 'base64'));
  writeFileSync(`${OUT}/model.glb`, Buffer.from(await page.evaluate((u) => window.forge.glb(u), any), 'base64'));
} catch (e) {
  report.failure = String(e?.message ?? e);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
  server.httpServer.close();
}
