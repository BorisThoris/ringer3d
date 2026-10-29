// Screenshot the Collection flow headlessly: menu -> Collection -> open a bag -> equip.
//   npm run build && node scripts/qa-collection.mjs   (CHROME_PATH, OUT_DIR optional)
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR ?? 'e2e-out/collection';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// QA_URL: test a deployed copy (e.g. the live Worker) instead of a local preview of dist/.
const URL_ = process.env.QA_URL ?? 'http://127.0.0.1:4179/';
const server = process.env.QA_URL ? null : await preview({ preview: { port: 4179, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${OUT}/profile`],
});
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 760 });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'medium' }));
    localStorage.setItem('ringer3d.wallet.v1', JSON.stringify({ coins: 2400, owned: [{ id: 'g99', tier: 'Rare', at: 1 }, { id: 'g4242', tier: 'Common', at: 2 }], lastDaily: -1, streak: 0, receipts: [], bagsOpened: 0 }));
  });
  await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(4000);
  await page.screenshot({ path: `${OUT}/1-menu.png` });
  const click = async (text) => {
    const ok = await page.evaluate((t) => {
      const all = [...document.querySelectorAll('button')].filter((x) => !x.disabled);
      const b = all.find((x) => x.getAttribute('aria-label') === t) ?? all.find((x) => x.textContent?.includes(t));
      b?.click();
      return !!b;
    }, text);
    if (!ok) throw new Error(`no button "${text}"`);
    await sleep(1500);
  };
  await click('Collection');
  await page.screenshot({ path: `${OUT}/2-collection.png` });
  await click('Open for');
  await sleep(1500);
  await page.screenshot({ path: `${OUT}/3-reveal.png` });
  for (let i = 0; i < 5; i++) await click('Open for');
  await click('Claim');
  await page.evaluate(() => document.querySelector('.gen-grid')?.scrollIntoView());
  await sleep(800);
  await page.screenshot({ path: `${OUT}/4-grid.png` });
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('ringer3d.wallet.v1')));
  console.log(JSON.stringify({ coins: state.coins, owned: state.owned.length, streak: state.streak, errors }));
} finally {
  await browser.close();
  server?.httpServer.close();
}
