// Screenshot every screen at a desktop and a phone size: the UI review set.
//   npm run build && node scripts/qa-ui-tour.mjs     (CHROME_PATH, OUT_DIR, QA_URL optional)
// Writes <OUT>/<size>-<nn>-<screen>.png and report.json (page errors per size).
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR ?? 'e2e-out/ui-tour';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL_ = process.env.QA_URL ?? 'http://127.0.0.1:4181/';
const server = process.env.QA_URL ? null : await preview({ preview: { port: 4181, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const SIZES = [
  { id: 'desktop', width: 1280, height: 800, mobile: false },
  { id: 'phone', width: 412, height: 870, mobile: true },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--user-data-dir=${OUT}/profile`],
});
const report = {};
try {
  for (const size of SIZES) {
    const errors = [];
    const missing = [];
    const page = await browser.newPage();
    await page.setViewport({ width: size.width, height: size.height, isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'low', playerName: 'Bobby' }));
      // A collection with one of everything worth showing: a Shiny, Mint and Chipped glass, the top tiers, five Commons to trade up.
      const ids = ['cR-Lqa000011', 'cE-Lqa000124', 'cR-Lqa000003', 'cL-Lqa000019', 'cM-Lqa000010', 'cE-Lqa000307', 'cC-Lqa000001', 'cC-Lqa000002', 'cC-Lqa000004', 'cC-Lqa000005', 'cC-Lqa000008'];
      const tierOf = { C: 'Common', R: 'Rare', E: 'Epic', L: 'Legendary', M: 'Mythic' };
      const owned = ids.map((id, i) => ({ id, tier: tierOf[id[1]], at: i + 1, tally: i === 0 ? 37 : 0 }));
      localStorage.setItem('ringer3d.wallet.v1', JSON.stringify({ coins: 1240, owned, lastDaily: -1, streak: 2, receipts: [], bagsOpened: 11 }));
    });
    await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(5000);
    let n = 0;
    const shot = async (name) => page.screenshot({ path: `${OUT}/${size.id}-${String(++n).padStart(2, '0')}-${name}.png` });
    const click = async (text) => {
      const ok = await page.evaluate((t) => {
        const all = [...document.querySelectorAll('button, [role=button]')].filter((x) => !x.disabled);
        const b = all.find((x) => x.getAttribute('aria-label') === t) ?? all.find((x) => x.textContent?.trim().includes(t));
        b?.click();
        return !!b;
      }, text);
      if (!ok) missing.push(text);
      await sleep(1400);
      return ok;
    };
    const back = async () => {
      await page.evaluate(() => (document.querySelector('.back, [aria-label=Back]') ?? [...document.querySelectorAll('button')].find((b) => /back|‹/i.test(b.textContent ?? '')))?.click());
      await sleep(1200);
    };

    await shot('menu');
    if (await click('Quick match')) {
      await shot('quick');
      if (await click('Play')) {
        await sleep(5000);
        await shot('match');
        await page.mouse.move(size.width / 2, size.height * 0.7);
        await page.mouse.down();
        await page.mouse.move(size.width / 2, size.height * 0.85, { steps: 8 });
        await sleep(400);
        await shot('aiming');
        await page.mouse.up();
        await sleep(6000);
        await shot('after-shot');
        // leave the match
        await page.evaluate(() => (document.querySelector('.hud-quit, [aria-label=Pause], [aria-label=Menu]') ?? [...document.querySelectorAll('button')].find((b) => /pause|quit|menu|❚❚|⏸/i.test(b.textContent + (b.getAttribute('aria-label') ?? ''))))?.click());
        await sleep(1200);
        await shot('pause');
        await click('Resume');
        // End the match as a win through the game's own end-of-match path (the coin reward runs).
        await page.evaluate(() => globalThis.__ringer.session.opts.onEnd({ winners: [0], scores: [7, 3], localSeats: [0] }));
        await sleep(2200);
        await shot('results');
        await click('Menu');
        await sleep(1500);
      }
    }
    await page.goto(URL_, { waitUntil: 'networkidle2' });
    await sleep(4000);
    if (await click('Tower')) {
      await shot('story-select');
      await page.evaluate(() => document.querySelector('.fighter, .story-card, .card')?.click());
      await sleep(1200);
      await shot('tower');
      await back();
      await back();
    }
    for (const [label, name] of [['Profile', 'profile'], ['Leaderboards', 'leaderboards'], ['Online', 'online'], ['Pass and play', 'local'], ['Collection', 'collection'], ['How to play', 'howto'], ['Settings', 'settings']]) {
      if (await click(label)) {
        await shot(name);
        if (name === 'collection') {
          // Inspect the Shiny, then trade-up mode with five Commons picked, then the Book and the store.
          await page.evaluate(() => [...document.querySelectorAll('.gen-card')].find((c) => c.classList.contains('shiny'))?.click());
          await sleep(1800);
          await shot('inspect');
          await click('Close');
          await click('Trade up');
          await page.evaluate(() => {
            const commons = [...document.querySelectorAll('.gen-card')].filter((c) => c.querySelector('.tier')?.textContent === 'Common').slice(0, 5);
            for (const c of commons) c.click();
            document.querySelector('.tradeup')?.scrollIntoView({ block: 'start' });
          });
          await sleep(900);
          await shot('tradeup');
          await page.evaluate(() => document.querySelector('.book')?.scrollIntoView({ block: 'start' }));
          await sleep(600);
          await shot('book');
          await page.evaluate(() => document.querySelector('.screen')?.scrollTo(0, 1e5));
          await sleep(600);
          await shot('collection-store');
        }
        await back();
      }
    }
    report[size.id] = { errors, missing, shots: n };
    await page.close();
  }
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
  server?.httpServer.close();
}
