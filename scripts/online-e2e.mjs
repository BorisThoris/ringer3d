// Two headless browsers play each other online through the real server:
// host creates a ring, guest finds it in the server browser, they connect
// (WebRTC, or the relay) and play first-to-7. Both must agree at the end.
//   npm run build && node scripts/online-e2e.mjs <outDir>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, flick, launch, logger, matchInfo } from './lib.mjs';

const out = process.argv[2] ?? 'online-out';
const say = logger(out);
const PORT = 8790;
const url = `http://localhost:${PORT}/`;

const server = spawn(process.execPath, ['server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
server.stdout.on('data', (d) => say('server:', String(d).trim()));
server.stderr.on('data', (d) => say('server!', String(d).trim()));
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${url}health`)).ok) break;
  } catch {
    /* not up yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await launch();
const errors = [];
async function player(name) {
  // Small viewports: both players share one software-GL process.
  const ctx = await browser.newContext({ viewport: { width: 560, height: 420 } });
  await ctx.addInitScript((n) => {
    localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'low', soundOn: false, playerName: n }));
  }, name);
  // Software GL renders two games on the CPU: give every action room.
  ctx.setDefaultTimeout(180000);
  const page = await ctx.newPage();
  collectErrors(page, errors, name);
  await page.goto(url);
  await page.waitForFunction(() => !!window.__ringer, null, { timeout: 60000 });
  return page;
}

let ok = false;
let hostPage;
let guestPage;
try {
  hostPage = await player('Hosty');
  guestPage = await player('Guesty');
  const shot = (p, n) => p.screenshot({ path: join(out, `${n}.png`) });

  await hostPage.getByRole('button', { name: /Online/ }).click();
  await hostPage.getByRole('button', { name: 'Create ring' }).click();
  await hostPage.waitForSelector('.code-big');
  const code = (await hostPage.locator('.code-big').textContent()).trim();
  say('room code', code);
  await hostPage.locator('[data-maj="1"]').click();

  // The guest finds it in the server browser, not by typing the code.
  await guestPage.getByRole('button', { name: /Online/ }).click();
  await guestPage.waitForSelector(`[data-room="${code}"]`, { timeout: 20000 });
  await shot(guestPage, '01-server-browser');
  await guestPage.locator(`[data-room="${code}"]`).click();
  await guestPage.waitForSelector('.code-big', { timeout: 20000 });

  await hostPage.waitForFunction(() => document.querySelectorAll('.seat').length === 2, null, { timeout: 20000 });
  await hostPage.waitForFunction(() => /Peer-to-peer|Relayed/.test(document.querySelector('.link-badge')?.textContent ?? ''), null, { timeout: 20000 });
  const link = await hostPage.locator('.link-badge').first().textContent();
  say('link', link);
  await shot(hostPage, '02-room-host');
  await shot(guestPage, '03-room-guest');
  // Starting builds the arena and bakes its reflections: in software GL that
  // blocks the page longer than a click's default wait, so click directly.
  await hostPage.evaluate(() => document.querySelector('[data-start]').click());

  await guestPage.waitForFunction(() => window.__ringer?.match?.role === 'client', null, { timeout: 20000 });
  say('match started on both');

  // Play: whoever is up flicks. First to 7 keeps it short.
  const pages = [hostPage, guestPage];
  const t0 = Date.now();
  let flicks = 0;
  let shotsTaken = false;
  while (Date.now() - t0 < 25 * 60 * 1000) {
    const [h, g] = await Promise.all(pages.map(matchInfo));
    if (h?.phase === 'over' && g?.phase === 'over') break;
    for (const [i, info] of [h, g].entries()) {
      if (info?.awaitingLocal) {
        const lag = info.stage === 'lag-wait';
        await flick(pages[i], (flicks % 3 - 1) * 30, lag ? 120 + (flicks % 2) * 15 : 150 + (flicks % 4) * 35);
        flicks++;
        if (!shotsTaken && flicks === 3) {
          await shot(pages[0], '04-host-playing');
          await shot(pages[1], '05-guest-playing');
          shotsTaken = true;
        }
        await pages[i].waitForTimeout(600);
      }
    }
    await hostPage.waitForTimeout(400);
    if (flicks % 5 === 0) say('progress', { host: h, guest: g });
  }
  const [h, g] = await Promise.all(pages.map(matchInfo));
  say('final host', h);
  say('final guest', g);
  await shot(hostPage, '06-host-end');
  await shot(guestPage, '07-guest-end');
  // The claim under test is sync: both devices agree after a real stretch of
  // play. Finishing first-to-7 with scripted flicks in software GL can exceed
  // the time budget, so it is reported, not required.
  const same = JSON.stringify([h.captured, h.shots, h.order, h.lag]) === JSON.stringify([g.captured, g.shots, g.order, g.lag]);
  say('finished', h.phase === 'over', 'shots', h.shots);
  if (h.shots < 30 && h.phase !== 'over') errors.push(`too few shots to judge sync: ${h.shots}`);
  if (!same) errors.push(`host and guest disagree: ${JSON.stringify(h)} vs ${JSON.stringify(g)}`);
  ok = errors.length === 0;
} catch (e) {
  errors.push(`online: ${e.message}`);
  await hostPage?.screenshot({ path: join(out, 'zz-host-failure.png') }).catch(() => {});
  await guestPage?.screenshot({ path: join(out, 'zz-guest-failure.png') }).catch(() => {});
}
await browser.close();
server.kill();
say('errors', errors);
writeFileSync(join(out, 'result.json'), JSON.stringify({ ok, errors }, null, 2));
process.exit(ok ? 0 : 1);
