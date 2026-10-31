// Store screenshots from the real game: menus and matches on several fields, played through the
// UI and keyboard like a player would. Writes PNGs to OUT_DIR (default e2e-out/store-shots).
//   npx vite build && node scripts/capture-store-shots.mjs      (CHROME_PATH optional)
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR ?? 'e2e-out/store-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await preview({ preview: { port: 4184, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${OUT}/profile`],
});

async function open({ width = 1280, height = 720, phone = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 3 : 1.5 });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'high', playerName: 'You' }));
    localStorage.setItem('ringer3d.hinted', '1');
  });
  await page.goto('http://127.0.0.1:4184/', { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(6000);
  return page;
}

const press = (page, t) =>
  page.evaluate((t) => {
    const all = [...document.querySelectorAll('button')].filter((x) => !x.disabled && x.getClientRects().length);
    const b = all.find((x) => x.getAttribute('aria-label') === t || x.querySelector('h3')?.textContent?.trim() === t || x.textContent?.trim().startsWith(t));
    b?.click();
    return !!b;
  }, t);

async function match(page, field) {
  await press(page, 'Quick match');
  await sleep(1200);
  await press(page, 'Field & map');
  await sleep(1200);
  await page.evaluate((f) => [...document.querySelectorAll('.arena-card')].find((c) => c.textContent.includes(f))?.click(), field);
  await sleep(800);
  await press(page, 'Done');
  await sleep(800);
  await press(page, 'Play');
  await sleep(9000);
}

/** Aim a little, then a flick of the given strength (ms of Space held). */
async function flick(page, aimMs, holdMs, aimKey = 'ArrowLeft') {
  await page.keyboard.down(aimKey);
  await sleep(aimMs);
  await page.keyboard.up(aimKey);
  await sleep(500);
  await page.keyboard.down('Space');
  await sleep(holdMs);
  await page.keyboard.up('Space');
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

try {
  // Home, with the ring idling behind the menu.
  let p = await open();
  await shot(p, '01-menu');
  await press(p, 'Shop');
  await sleep(2500);
  await shot(p, '02-shop');
  await p.close();

  for (const [i, field] of ['The Desk', 'The Back Lawn', 'The Beach', 'The Frozen Lake', 'The Mini-Golf Course'].entries()) {
    p = await open();
    const tag = field.replace(/^The /, '').toLowerCase().replace(/\W+/g, '-');
    await match(p, field);
    await flick(p, 120 + i * 60, 0, i % 2 ? 'ArrowRight' : 'ArrowLeft');
    await sleep(800);
    await shot(p, `1${i}-${tag}-aim`);
    await p.keyboard.down('Space');
    await sleep(700);
    await shot(p, `1${i}-${tag}-charge`);
    await p.keyboard.up('Space');
    for (const t of [500, 1100, 2200]) {
      await sleep(t === 500 ? 500 : t - 500);
      await shot(p, `1${i}-${tag}-roll-${t}`);
    }
    await sleep(6000);
    await p.keyboard.press('KeyT');
    await sleep(2500);
    await shot(p, `1${i}-${tag}-top`);
    await p.close();
  }

  // A phone, upright.
  p = await open({ width: 393, height: 852, phone: true });
  await shot(p, '30-phone-menu');
  await press(p, 'Quick match');
  await sleep(2000);
  await shot(p, '31-phone-quick');
  await press(p, 'Play');
  await sleep(9000);
  await shot(p, '32-phone-match');
  await p.close();
} catch (e) {
  console.error(e);
} finally {
  await browser.close();
  server.httpServer.close();
}
