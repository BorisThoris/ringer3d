// Headless smoke play: serves the production build, plays real flicks through
// the UI in a phone and a desktop viewport, screenshots each step.
// Run inside the isolated window station (see README), never on the desktop:
//   node scripts/smoke.mjs <outDir>
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'smoke-out';
mkdirSync(out, { recursive: true });
const log = [];
const say = (...a) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  log.push(line);
  console.log(line);
  writeFileSync(join(out, 'smoke.log'), log.join('\n'));
};

const exe =
  process.env.CHROME_PATH ??
  [
    `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium_headless_shell-1243\\chrome-headless-shell-win64\\chrome-headless-shell.exe`,
    `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium_headless_shell-1228\\chrome-headless-shell-win64\\chrome-headless-shell.exe`,
  ].find((p) => existsSync(p));

const server = await preview({ preview: { port: 5182, strictPort: true }, logLevel: 'error' });
const url = 'http://localhost:5182/';
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
});

const app = (page, f) => page.evaluate(f);
const matchInfo = (page) =>
  app(page, () => {
    const m = window.__ringer.match;
    if (!m) return null;
    return {
      stage: m.stage.kind,
      phase: m.state.phase,
      awaitingLocal: m.awaitingLocal,
      shots: m.state.shots,
      captured: m.state.captured.map((c) => c.length),
      left: Object.keys(m.state.targets).length,
      event: m.state.event.kind,
      order: m.state.order,
    };
  });

async function waitFor(page, pred, timeout = 90000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const info = await matchInfo(page);
    if (pred(info)) return info;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(await matchInfo(page))}`);
}

async function flick(page, pullX, pullY) {
  const vp = page.viewportSize();
  const x = vp.width * 0.5;
  const y = vp.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + pullX, y + pullY, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

const failures = [];

async function run(name, viewport, opts = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  const shot = (s) => page.screenshot({ path: join(out, `${name}-${s}.png`) });
  try {
    await page.goto(url);
    await page.waitForFunction(() => !!window.__ringer, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    await shot('01-home');
    const gl = await page.evaluate(() => {
      const c = document.getElementById('view');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    });
    say(name, 'webgl', gl);

    await page.getByText('How to play').click();
    await page.waitForTimeout(400);
    await shot('02-howto');
    await page.getByRole('button', { name: 'Got it' }).click();

    // Quick match vs rookie, no lag: we shoot first.
    await page.getByText('Quick Match').click();
    await page.getByRole('button', { name: 'Rookie' }).click();
    await page.getByRole('button', { name: 'You go first' }).click();
    await page.waitForTimeout(300);
    await shot('03-setup');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    let info = await waitFor(page, (i) => i?.awaitingLocal, 30000, 'our first turn');
    await page.waitForTimeout(1500);
    await shot('04-aim');
    say(name, 'first turn', info);

    // Pull straight down: shoot straight ahead at the cross.
    await flick(page, 0, Math.min(viewport.height * 0.3, 260));
    info = await waitFor(page, (i) => i && i.shots >= 1 && i.stage !== 'roll', 120000, 'first shot to settle');
    say(name, 'after first shot', info);
    await page.waitForTimeout(400);
    await shot('05-after-shot');

    // Keep playing (us flicking with varied pulls, the bot on its own) for a while.
    let turns = 0;
    while (turns < 10) {
      info = await matchInfo(page);
      if (!info || info.phase === 'over') break;
      if (info.awaitingLocal) {
        await flick(page, (turns % 3 - 1) * 25, 140 + (turns % 4) * 40);
        turns++;
        await waitFor(page, (i) => !i || i.phase === 'over' || (i.stage !== 'roll' && !i.awaitingLocal) || (i.awaitingLocal && i.shots > info.shots), 120000, 'shot resolve');
      } else {
        await page.waitForTimeout(500);
      }
    }
    info = await matchInfo(page);
    say(name, 'after play', info);
    await shot('06-later');
    if (!(info.shots >= 2)) failures.push(`${name}: expected several shots, got ${info.shots}`);

    // Pause menu and back.
    await page.getByLabel('Pause').click();
    await page.waitForTimeout(300);
    await shot('07-pause');
    await page.getByRole('button', { name: 'Quit to menu' }).click();
    await page.waitForTimeout(500);

    // Story: versus screen, then the lag.
    await page.getByRole('button', { name: /Story/ }).click();
    await page.waitForTimeout(400);
    await shot('08-tower');
    await page.getByRole('button', { name: /^Fight/ }).click();
    await page.waitForTimeout(900);
    await shot('09-versus');
    await waitFor(page, (i) => i?.awaitingLocal && i.stage === 'lag-wait', 30000, 'story lag');
    await page.waitForTimeout(800);
    await shot('10-lag');
    await flick(page, 0, 120);
    info = await waitFor(page, (i) => i && (i.stage === 'aim' || i.stage === 'lag-wait') && i.order.length > 0, 120000, 'lagging done');
    say(name, 'after lag', info);
    await page.waitForTimeout(1500);
    await shot('11-story-turn');

    // Every arena, by the app's own quick-match path.
    if (name === 'desktop') {
      for (const arena of ['schoolyard', 'rooftop', 'parlour', 'courtyard']) {
        await page.evaluate((a) => {
          const appObj = window.__ringer;
          appObj.quick = { opponent: 'regular', arena: a, majority: false, lag: false };
          appObj.playQuick();
        }, arena);
        await waitFor(page, (i) => i?.awaitingLocal, 30000, `arena ${arena}`);
        await page.waitForTimeout(2500);
        await shot(`12-arena-${arena}`);
      }
    }
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    await shot('zz-failure').catch(() => {});
  }
  if (errors.length) failures.push(...errors.map((e) => `${name}: ${e}`));
  say(name, 'errors', errors);
  await ctx.close();
}

await run('phone', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
await run('desktop', { width: 1280, height: 800 });

await browser.close();
await server.close();
say('FAILURES', failures);
writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: failures.length === 0, failures }, null, 2));
process.exit(failures.length ? 1 : 0);
