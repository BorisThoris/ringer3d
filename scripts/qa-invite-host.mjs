// Hosts an online room in headless Chrome and waits for someone to join it: the other half of an
// invite-link test (e.g. an Android build opening <link> from the room's Invite button).
//   npm run build && node scripts/qa-invite-host.mjs      (OUT_DIR, WAIT_MS, CHROME_PATH optional)
// Writes <OUT>/room.json as soon as the room exists ({ code, link }), then report.json at the end.
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';

// Same form as src/invite.ts inviteLink (that module needs a browser).
const inviteLink = (code) => `https://ringer3d.modaxxx009.workers.dev/join?room=${code}`;

const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT = process.env.OUT_DIR ?? 'e2e-out/invite';
const WAIT = +(process.env.WAIT_MS ?? 180000);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await preview({ preview: { port: 4182, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${OUT}/profile`],
});
const report = { errors: [] };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', (e) => report.errors.push(e.message));
  await page.evaluateOnNewDocument(() => localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'low', playerName: 'WebHost', netMode: 'p2p' })));
  await page.goto('http://127.0.0.1:4182/', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);
  const click = (t) =>
    page.evaluate((t) => {
      const b = [...document.querySelectorAll('button')].find((x) => !x.disabled && (x.getAttribute('aria-label') === t || x.textContent?.trim().includes(t)));
      b?.click();
      return !!b;
    }, t);
  await click('Online');
  await sleep(1500);
  await click('Host a room');
  await sleep(800);
  await click('Create room');
  await page.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('.code-input')?.textContent?.trim() ?? ''), { timeout: 30000 });
  const code = await page.evaluate(() => document.querySelector('.code-input').textContent.trim());
  report.code = code;
  report.link = inviteLink(code);
  writeFileSync(`${OUT}/room.json`, JSON.stringify({ code, link: report.link }));
  // JOIN_IN_BROWSER=1: a second player (its own browser profile) opens the invite link here.
  if (process.env.JOIN_IN_BROWSER) {
    const guestCtx = await browser.createBrowserContext();
    const guest = await guestCtx.newPage();
    await guest.setViewport({ width: 412, height: 870, isMobile: true, hasTouch: true });
    guest.on('pageerror', (e) => report.errors.push(`guest: ${e.message}`));
    await guest.evaluateOnNewDocument(() => localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'low', playerName: 'LinkGuest' })));
    await guest.goto(`http://127.0.0.1:4182/join?room=${code}`, { waitUntil: 'networkidle2', timeout: 90000 });
    report.guest = guest;
  }
  // Wait for a second player in the roster.
  const t0 = Date.now();
  while (Date.now() - t0 < WAIT) {
    // Player rows are the list items with a marble; the room code sits in a list item too.
    const roster = await page.evaluate(() => [...document.querySelectorAll('.list-item')].filter((li) => li.querySelector('.marble')).map((li) => li.querySelector('b')?.textContent ?? ''));
    report.roster = roster;
    if (roster.length >= 2) {
      report.joinedAfterMs = Date.now() - t0;
      break;
    }
    await sleep(1000);
  }
  await page.screenshot({ path: `${OUT}/host-room.png` });
  if (report.guest) {
    const guest = report.guest;
    delete report.guest;
    report.guestUrl = guest.url();
    report.guestRoom = await guest.evaluate(() => document.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? null);
    await guest.screenshot({ path: `${OUT}/guest-room.png` });
  }
} catch (e) {
  report.failure = String(e.message ?? e);
} finally {
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  server.httpServer.close();
}
