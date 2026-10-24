// Shared bits for the headless scripts: browser launch, logging, match polling.
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function logger(out) {
  mkdirSync(out, { recursive: true });
  const lines = [];
  return (...a) => {
    const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    lines.push(line);
    console.log(line);
    writeFileSync(join(out, 'run.log'), lines.join('\n'));
  };
}

export function chromePath() {
  return (
    process.env.CHROME_PATH ??
    ['1243', '1228'].map((v) => `${process.env.LOCALAPPDATA}\\ms-playwright\\chromium_headless_shell-${v}\\chrome-headless-shell-win64\\chrome-headless-shell.exe`).find((p) => existsSync(p))
  );
}

export function launch() {
  return chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
  });
}

export const matchInfo = (page) =>
  page.evaluate(() => {
    const m = window.__ringer?.match;
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
      lag: m.lagResults,
      role: m.role,
    };
  });

export async function waitFor(page, pred, timeout = 90000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const info = await matchInfo(page);
    if (pred(info)) return info;
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(await matchInfo(page))}`);
}

/** Pull back from the middle of the screen and release. */
export async function flick(page, pullX, pullY) {
  const vp = page.viewportSize();
  const x = vp.width * 0.5;
  const y = vp.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + pullX, y + pullY, { steps: 12 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

export function collectErrors(page, into, name) {
  page.on('pageerror', (e) => into.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && into.push(`${name} console: ${m.text()}`));
}
