#!/usr/bin/env node
/**
 * End-to-end online test: two separate browser profiles play each other.
 *
 *   NET_MODE=p2p    (default) serverless: listing + handshake over public Nostr relays
 *   NET_MODE=server through the Ringer lobby server
 *
 * Expects the built app served at APP_URL (default http://localhost:8787, e.g. `npm run server`).
 * Uses puppeteer-core with CHROME_PATH (defaults to the system Chrome on CI runners).
 * Exits non-zero on any failure. Screenshots go to e2e-out/.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const MODE = process.env.NET_MODE ?? 'p2p';
const APP_URL = process.env.APP_URL ?? 'http://localhost:8787/';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const OUT = 'e2e-out';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = async (msg) => {
  console.error(`FAIL [${MODE}]: ${msg}`);
  for (const [n, p] of [['A', A], ['B', B]]) await p?.screenshot({ path: `${OUT}/${MODE}-fail-${n}.png` }).catch(() => {});
  await browser.close();
  process.exit(1);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

let A = null;
let B = null;
async function client(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 900, height: 640 });
  page.on('pageerror', (e) => console.log(name, 'PAGEERROR', e.message));
  await page.evaluateOnNewDocument(
    (n, mode) => localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'low', playerName: n, netMode: mode, lobbyUrl: 'ws://localhost:8787' })),
    name,
    MODE,
  );
  await page.goto(APP_URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForFunction(() => !!globalThis.__ringer?.view, { timeout: 60000 });
  return page;
}
const click = (page, t) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t) && !b.disabled);
    el?.click();
    return !!el;
  }, t);
const state = (p) =>
  p.evaluate(() => {
    const s = globalThis.__ringer.session;
    const m = s?.match;
    return m && s.opts.mode === 'online' ? { hash: m.hash(), phase: m.phase, shots: m.shotsTaken, my: s.myTurn } : null;
  });

A = await client('Alice');
B = await client('Bob');

// Alice hosts a public room.
await click(A, 'Online');
await sleep(1000);
await click(A, 'Host a room');
await sleep(300);
await click(A, 'Create room');
await A.waitForFunction(() => /^[A-Z]{4}$/.test(document.querySelector('.code-input')?.textContent ?? ''), { timeout: 30000 }).catch(() => fail('host never got a room code'));
const code = await A.evaluate(() => document.querySelector('.code-input').textContent);
console.log(`[${MODE}] room code ${code}`);

// Bob finds it in the server browser (proves listing works), then joins by clicking it.
await click(B, 'Online');
let listed = false;
for (let i = 0; i < 24 && !listed; i++) {
  await click(B, 'Refresh');
  await sleep(2500);
  listed = await B.evaluate(() => [...document.querySelectorAll('.list-item b')].some((b) => b.textContent === "Alice's ring"));
}
console.log(`[${MODE}] room listed in browser: ${listed}`);
if (!listed) await fail('room never appeared in the server browser');
await B.evaluate(() => [...document.querySelectorAll('button.list-item')].find((b) => b.textContent.includes("Alice's ring"))?.click());

// Wait until Bob is in the room and both see each other.
await B.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes("I'm ready")), { timeout: 45000 }).catch(() => fail('guest never entered the room'));
await click(B, "I'm ready");
await A.waitForFunction(() => [...document.querySelectorAll('.pill')].filter((p) => p.textContent === 'Ready').length >= 2, { timeout: 30000 }).catch(() => fail('host never saw the guest ready'));
const roster = await A.evaluate(() => [...document.querySelectorAll('.list-item small')].map((s) => s.textContent));
console.log(`[${MODE}] host roster:`, roster.join(' | '));
await A.screenshot({ path: `${OUT}/${MODE}-lobby.png` });
await click(A, 'Start match');
await A.waitForFunction(() => globalThis.__ringer.session?.opts.mode === 'online', { timeout: 20000 }).catch(() => fail('match did not start on host'));
await B.waitForFunction(() => globalThis.__ringer.session?.opts.mode === 'online', { timeout: 20000 }).catch(() => fail('match did not start on guest'));

// Play shots, alternating whoever's turn it is; every settled table must match.
let compared = 0;
for (let i = 0; i < 80 && compared < 6; i++) {
  const [a, b] = [await state(A), await state(B)];
  if (!a || !b) await fail('lost the match session');
  if (a.phase === 'gameOver' && b.phase === 'gameOver') break;
  if (a.phase === 'aim' && b.phase === 'aim' && a.shots === b.shots) {
    if (a.hash !== b.hash) await fail(`tables differ after shot ${a.shots}: ${a.hash} vs ${b.hash}`);
    if (a.shots > compared) compared = a.shots;
    const page = a.my ? A : b.my ? B : null;
    if (page)
      await page.evaluate((k) => {
        const s = globalThis.__ringer.session;
        s.rotateAim(Math.sin(k) * 0.08);
        s.setPower(0.55 + (k % 4) * 0.12);
        s.release();
      }, i);
  }
  await sleep(1500);
}
await A.screenshot({ path: `${OUT}/${MODE}-game-host.png` });
await B.screenshot({ path: `${OUT}/${MODE}-game-guest.png` });
if (compared < 4) await fail(`only ${compared} shots were played`);
const logA = await A.evaluate(() => JSON.stringify(globalThis.__ringer.session.match.shotLog.map((l) => [l.n, l.before, l.after])));
const logB = await B.evaluate(() => JSON.stringify(globalThis.__ringer.session.match.shotLog.map((l) => [l.n, l.before, l.after])));
console.log(`[${MODE}] shot logs identical: ${logA === logB} (${compared} shots compared)`);
console.log(`PASS [${MODE}]`);
await browser.close();
