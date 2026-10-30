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
];
// [name, buttons to press from the menu]
const SCREENS = [
  ['menu', []],
  ['shop', ['Shop']],
  ['coins', ['150 coins: get more']],
  ['marbles', ['Shop', 'My marbles']],
  ['settings', ['Settings']],
  ['profile', ['Profile']],
  ['quick', ['Quick match']],
  ['local', ['Pass and play']],
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
try {
  for (const v of VIEWS) {
    const page = await browser.newPage();
    await page.setViewport({ width: v.width, height: v.height, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.evaluateOnNewDocument(() => localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'low', playerName: 'Phone' })));
    for (const [name, path] of SCREENS) {
      await page.goto('http://127.0.0.1:4183/', { waitUntil: 'networkidle2', timeout: 90000 });
      await sleep(2500);
      for (const t of path) {
        await page.evaluate((t) => {
          const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && (x.getAttribute('aria-label') === t || x.querySelector('h3')?.textContent?.trim() === t || x.textContent?.trim().startsWith(t)));
          b?.click();
        }, t);
        await sleep(1500);
      }
      const r = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        const label = (e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : ''}`;
        const clipped = new Set();
        const scrollers = [];
        for (const e of document.querySelectorAll('.overlay *')) {
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
              if (/(auto|scroll)/.test(ps.overflowY + ps.overflowX)) { scrollable = true; break; }
              p = p.parentElement;
            }
            clipped.add(`${scrollable ? 'scroll' : 'UNREACHABLE'} ${label(e)} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}" @${Math.round(b.left)},${Math.round(b.top)}`);
          }
        }
        // The pinned action and the "More" hint, if the screen has them.
        const foot = document.querySelector('.screen-foot');
        const action = foot?.querySelector('.btn');
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
    await page.close();
  }
} catch (e) {
  report.failure = String(e.stack ?? e);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  server.httpServer.close();
}
