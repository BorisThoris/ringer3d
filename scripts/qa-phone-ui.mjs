// Screenshots every menu screen at phone sizes and reports what does not fit: content past the
// screen edge, and scroll areas whose hidden part gives no hint that it is there.
//   npm run build && node scripts/qa-phone-ui.mjs      (OUT_DIR, CHROME_PATH optional)
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR ?? 'e2e-out/phone-ui';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const VIEWS = [
  { id: 'portrait', width: 393, height: 780 },
  { id: 'landscape', width: 852, height: 360 },
  { id: 'desktop', width: 1280, height: 800, desktop: true },
];
// [name, buttons to press from the menu]
const SCREENS = [
  ['menu', []],
  ['shop', ['Shop']],
  ['coins', ['150 coins: get more']],
  ['marbles', ['Marbles']],
  ['settings', ['Settings']],
  ['profile', ['Profile']],
  ['quick', ['Quick match']],
  ['quick-opponent', ['Quick match', 'Opponent']],
  ['quick-map', ['Quick match', 'Field & map']],
  ['quick-shooter', ['Quick match', 'Your shooter']],
  ['local', ['Pass and play']],
  ['reset-confirm', ['Settings', 'Reset Tower progress']],
  ['online', ['Online']],
  ['tower', ['Tower']],
  ['howto', ['How to play']],
  ['leaderboards', ['Leaderboards']],
];

const server = await preview({ preview: { port: 4183, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${OUT}/profile`],
});
const report = {};

/** Presses the first visible, enabled button labelled (or starting with) t. */
async function press(page, t) {
  return page.evaluate((t) => {
    const all = [...document.querySelectorAll('button')].filter((x) => !x.disabled && x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');
    const b = all.find((x) => x.getAttribute('aria-label') === t || x.querySelector('h3')?.textContent?.trim() === t || x.textContent?.trim().startsWith(t));
    b?.click();
    return !!b;
  }, t);
}

/** Where the app is: the screen, open sheets, the pause menu. */
const where = (page) =>
  page.evaluate(() => ({
    screen: document.querySelector('#root > .overlay')?.getAttribute('data-screen') ?? (document.querySelector('.hud') ? 'game' : null),
    sheet: document.querySelector('.modal [role=dialog]')?.getAttribute('aria-label') ?? null,
    paused: !!document.querySelector('.hud .overlay'),
  }));

/**
 * Back, every way a phone does it: the browser's back (page.goBack, i.e. popstate) and Android's
 * (window.ringerBack, what MainActivity calls). Each step: [how, expected screen, sheet?, paused?].
 */
async function backTests(page) {
  const out = [];
  const check = async (label, want) => {
    await sleep(900);
    const w = await where(page);
    const ok = Object.entries(want).every(([k, v]) => w[k] === v);
    out.push(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${JSON.stringify(w)}${ok ? '' : ` want ${JSON.stringify(want)}`}`);
  };
  const androidBack = () => page.evaluate(() => window.ringerBack());
  await page.goto('http://127.0.0.1:4183/', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2500);
  out.push(`home: ringerBack() = ${await page.evaluate(() => window.ringerBack())} (want exit)`);
  await press(page, 'Quick match');
  await check('open Quick match', { screen: 'quick', sheet: null });
  await press(page, 'Opponent');
  await check('open Opponent sheet', { screen: 'quick', sheet: 'Opponent' });
  await page.goBack();
  await check('browser back closes the sheet', { screen: 'quick', sheet: null });
  await page.goBack();
  await check('browser back to home', { screen: 'menu' });
  await press(page, 'Shop');
  await check('Shop tab', { screen: 'collection' });
  await press(page, 'Marbles');
  await check('Marbles tab', { screen: 'collection' });
  out.push(`  Android back from a tab: ${await androidBack()}`);
  await check('Android back from a tab goes home', { screen: 'menu' });
  await press(page, 'Online');
  await check('open Online', { screen: 'online' });
  out.push(`  Android back: ${await androidBack()}`);
  await check('Android back to home', { screen: 'menu' });
  out.push(`home again: ringerBack() = ${await page.evaluate(() => window.ringerBack())} (want exit)`);
  await press(page, 'Settings');
  await press(page, 'Reset Tower progress');
  await check('reset asks first', { screen: 'settings', sheet: 'Reset the Tower?' });
  await androidBack();
  await check('Android back cancels it', { screen: 'settings', sheet: null });
  await press(page, 'Play');
  await press(page, 'Quick match');
  await sleep(600);
  await press(page, 'Play');
  await sleep(3000);
  await check('match started', { screen: 'game', paused: false });
  await androidBack();
  await check('Android back in a match pauses', { screen: 'game', paused: true });
  await page.goBack();
  await check('browser back resumes', { screen: 'game', paused: false });
  await press(page, 'Pause');
  await sleep(300);
  await press(page, 'Quit to menu');
  await check('quit to menu', { screen: 'menu' });
  return out;
}
try {
  for (const v of VIEWS) {
    const page = await browser.newPage();
    await page.setViewport({ width: v.width, height: v.height, isMobile: !v.desktop, hasTouch: !v.desktop, deviceScaleFactor: v.desktop ? 1 : 2 });
    await page.evaluateOnNewDocument(() => localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'low', playerName: 'Phone' })));
    for (const [name, path] of SCREENS) {
      await page.goto('http://127.0.0.1:4183/', { waitUntil: 'networkidle2', timeout: 90000 });
      await sleep(2500);
      for (const t of path) {
        await press(page, t);
        await sleep(1500);
      }
      const r = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        const label = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
        const clipped = new Set();
        const scrollers = [];
        for (const e of document.querySelectorAll('.overlay *, .modal *')) {
          const s = getComputedStyle(e);
          if (s.visibility === 'hidden' || s.display === 'none') continue;
          const b = e.getBoundingClientRect();
          if (!b.width || !b.height) continue;
          if ((/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4) || (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 4))
            scrollers.push(`${label(e)} ${e.clientWidth}x${e.clientHeight} of ${e.scrollWidth}x${e.scrollHeight}`);
          if (e.matches('button, a, input, select, [role=button]') && (b.right > vw + 1 || b.bottom > vh + 1 || b.left < -1 || b.top < -1)) {
            // Off screen and not reachable by scrolling an ancestor?
            let p = e.parentElement, scrollable = false;
            while (p && p !== document.body) {
              const ps = getComputedStyle(p);
              if (/(auto|scroll)/.test(ps.overflowY + ps.overflowX)) {
                // Above a scroller's top with the scroller at 0: no scroll reaches it (flex-end overflow).
                scrollable = !(b.top < p.getBoundingClientRect().top - 1 && p.scrollTop === 0);
                break;
              }
              p = p.parentElement;
            }
            clipped.add(`${scrollable ? 'scroll' : 'UNREACHABLE'} ${label(e)} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}" @${Math.round(b.left)},${Math.round(b.top)}`);
          }
        }
        // The pinned action and the "More" hint, if the screen has them.
        const foot = document.querySelector('.modal .modal-foot') ?? document.querySelector('.screen-foot');
        const action = foot?.querySelector('.btn.primary') ?? foot?.querySelector('.btn');
        const ab = action?.getBoundingClientRect();
        return {
          clipped: [...clipped].slice(0, 25),
          scrollers,
          docScroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
          more: !!foot?.classList.contains('more'),
          action: action ? `${action.textContent.trim()} @${Math.round(ab.top)}-${Math.round(ab.bottom)} visible=${ab.bottom <= vh && ab.top >= 0}` : null,
        };
      });
      report[`${v.id}/${name}`] = r;
      await page.screenshot({ path: `${OUT}/${v.id}-${name}.png` });
    }
    if (v.id === 'portrait') report.back = await backTests(page);
    await page.close();
  }
} catch (e) {
  report.failure = String(e.stack ?? e);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  server.httpServer.close();
}
