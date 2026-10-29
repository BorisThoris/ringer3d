// The collection inside the Steam shell, live: Steam-held marbles, a drop check, and close-ups
// of wear (a Chipped and a Mint marble). Steam running and logged in; run it in an isolated
// window station (it opens a real window).
//   npm run build && node scripts/qa-steam-items.mjs      (OUT_DIR optional)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const OUT = process.env.OUT_DIR ?? 'e2e-out/steam-items';
mkdirSync(OUT, { recursive: true });
const require = createRequire(new URL('../steam/package.json', import.meta.url));
const electron = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(electron, ['.', '--remote-debugging-port=9334', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], {
  cwd: new URL('../steam/', import.meta.url),
  env: { ...process.env, SteamNoOverlayUIDrawing: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

const report = { errors: [] };
try {
  let browser = null;
  for (let i = 0; i < 40 && !browser; i++) {
    await sleep(500);
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9334', defaultViewport: null }).catch(() => null);
  }
  if (!browser) throw new Error('Electron did not open a debuggable window');
  let page = null;
  for (let i = 0; i < 20 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().startsWith('app://')) ?? null;
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('no game page');
  page.on('pageerror', (e) => report.errors.push(e.message));
  // A local collection with a Chipped and a Mint marble next to whatever Steam holds.
  await page.evaluate(() => {
    const owned = [
      { id: 'cR-Lqa000003', tier: 'Rare', at: 1 },
      { id: 'cE-Lqa000124', tier: 'Epic', at: 2 },
    ];
    localStorage.setItem('ringer3d.wallet.v1', JSON.stringify({ coins: 900, owned, lastDaily: -1, streak: 0, receipts: [], bagsOpened: 2 }));
    localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'medium' }));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.topbar', { timeout: 90000 });
  await sleep(3000);
  const click = async (t) => {
    const ok = await page.evaluate((t) => {
      const all = [...document.querySelectorAll('button')].filter((x) => !x.disabled);
      const b = all.find((x) => x.getAttribute('aria-label') === t) ?? all.find((x) => x.textContent?.includes(t));
      b?.click();
      return !!b;
    }, t);
    await sleep(1500);
    return ok;
  };
  await click('Collection');
  await sleep(2500);
  report.steam = await page.evaluate(() => ({
    section: document.querySelector('.steam-inv')?.textContent ?? null,
    steamCards: document.querySelectorAll('.gen-card .corner.steam').length,
  }));
  await page.evaluate(() => document.querySelector('.steam-inv')?.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${OUT}/1-steam-section.png` });
  // Inspect the first Steam marble, then the Chipped and Mint ones up close.
  const inspect = async (pred, name) => {
    await page.evaluate((p) => [...document.querySelectorAll('.gen-card')].find((c) => new Function('c', `return ${p}`)(c))?.click(), pred);
    await sleep(2500);
    const box = await page.evaluate(() => {
      const r = document.querySelector('.inspect')?.getBoundingClientRect();
      return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
    });
    if (box) await page.screenshot({ path: `${OUT}/${name}.png`, clip: box });
    report[name] = await page.evaluate(() => document.querySelector('.inspect .facts')?.textContent ?? null);
  };
  await inspect("!!c.querySelector('.corner.steam')", '2-steam-marble');
  await inspect("c.textContent.includes('CH')", '3-chipped');
  await inspect("c.textContent.includes('MT')", '4-mint');
  report.drop = await click('Check for a drop');
  await sleep(4000);
  report.toast = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? null);
  await page.screenshot({ path: `${OUT}/5-after-drop.png` });
  // Platform services beyond items: the leaderboards and friends, from the menu.
  const toMenu = () => page.evaluate(() => (document.querySelector('.back, [aria-label=Back]') ?? [...document.querySelectorAll('button')].find((b) => /back|‹/i.test(b.textContent ?? '')))?.click());
  await toMenu();
  await sleep(2000);
  report.leaderboardsButton = await click('Leaderboards');
  await sleep(4000);
  report.leaderboards = await page.evaluate(() => ({
    rows: document.querySelectorAll('.board-list li').length,
    notice: document.querySelector('.notice')?.textContent ?? document.querySelector('.screen .fine')?.textContent ?? null,
  }));
  await page.screenshot({ path: `${OUT}/6-leaderboards.png` });
  await toMenu();
  await sleep(2000);
  await click('Online');
  await sleep(5000);
  report.friends = await page.evaluate(() => ({
    shown: document.querySelectorAll('.friend').length,
    inGame: document.querySelectorAll('.friend.in-game').length,
  }));
  await page.screenshot({ path: `${OUT}/7-online-friends.png` });
  report.platform = await page.evaluate(() => !!window.steam);
  browser.disconnect();
} catch (e) {
  report.failure = String(e.message ?? e);
} finally {
  child.kill();
  report.log = log.split('\n').filter((l) => /error|inventory/i.test(l)).slice(0, 20);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
