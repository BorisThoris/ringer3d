// Launch the Steam shell (steam/, Electron) and check the game loads and runs inside it:
//   npm run build && node scripts/qa-steam-shell.mjs      (OUT_DIR optional)
// Runs with or without Steam: reports whether the bridge came up. Run it in an isolated
// window station on a shared desktop: it opens a real window.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const OUT = process.env.OUT_DIR ?? 'e2e-out/steam-shell';
mkdirSync(OUT, { recursive: true });
const require = createRequire(new URL('../steam/package.json', import.meta.url));
const electron = require('electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// STEAM_SHELL_EXE: test a packaged build (steam/dist/win-unpacked/Ringer 3D.exe) instead.
const exe = process.env.STEAM_SHELL_EXE;
const child = spawn(exe ?? electron, [...(exe ? [] : ['.']), '--remote-debugging-port=9333', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'], {
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
    browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333', defaultViewport: null }).catch(() => null);
  }
  if (!browser) throw new Error('Electron did not open a debuggable window');
  let page = null;
  for (let i = 0; i < 20 && !page; i++) {
    page = (await browser.pages()).find((p) => p.url().startsWith('app://')) ?? null;
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('no game page');
  page.on('pageerror', (e) => report.errors.push(e.message));
  await sleep(6000);
  Object.assign(
    report,
    await page.evaluate(() => ({
      url: location.href,
      steamBridge: !!window.steam,
      appId: window.steam?.appId ?? null,
      title: document.title,
      menu: !!document.querySelector('.menu'),
      canvas: !!document.querySelector('canvas'),
    })),
  );
  if (report.steamBridge) {
    report.me = await page.evaluate(() => window.steam.me());
    // The live Steam calls the game makes, through the bridge, one account.
    report.live = await page.evaluate(async () => {
      const s = window.steam;
      const me = (await s.me()).steamId;
      const got = [];
      const off = s.onP2P((from, text) => got.push({ from, text }));
      const lobby = await s.createLobby('public', 2);
      await s.setLobbyData(lobby, { game: 'ringer3d', code: 'QA', name: 'qa' });
      await new Promise((r) => setTimeout(r, 1500));
      const listed = (await s.listLobbies()).some((l) => l.id === lobby);
      const owner = (await s.lobbyOwner(lobby)) === me;
      const members = await s.lobbyMembers(lobby);
      const data = (await s.lobbyData(lobby)).game ?? null;
      const sent = await s.sendP2P(me, JSON.stringify({ t: 'qa' }));
      await new Promise((r) => setTimeout(r, 1500));
      off();
      await s.leaveLobby(lobby);
      const ticket = await s.webApiTicket('ringer3d-store');
      return {
        lobby: { listed, owner, members: members.length, data },
        p2p: { sent, received: got.some((m) => m.from === me && m.text.includes('qa')) },
        // syncCloud writes these on launch
        cloud: {
          settings: !!(await s.cloudRead('settings.json')),
          wallet: !!(await s.cloudRead('wallet.json')),
          roundTrip: (await s.cloudWrite('qa.json', 'qa')) && (await s.cloudRead('qa.json')) === 'qa',
          savedAt: localStorage.getItem('ringer3d.savedAt.v1'),
        },
        stats: { set: await s.statSet('NumGames', (await s.statGet('NumGames')) ?? 0), store: await s.statsStore() },
        achievementsCall: Array.isArray(await s.achievements(['FIRST_WIN'])),
        ticket: typeof ticket === 'string' && ticket.length > 20,
      };
    });
  }
  await page.screenshot({ path: `${OUT}/steam-shell.png` });
  browser.disconnect();
} catch (e) {
  report.failure = String(e.message ?? e);
} finally {
  child.kill();
  report.log = log.split('\n').filter((l) => /error|steam/i.test(l)).slice(0, 20);
  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
