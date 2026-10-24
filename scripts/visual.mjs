// Visual pass: the marbles up close. Taw picker (every taw), versus screen,
// and an in-game close-up on each field, at full glass quality.
//   node scripts/visual.mjs <outDir>
import { preview } from 'vite';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectErrors, launch, logger, waitFor } from './lib.mjs';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'visual-out';
const say = logger(out);
const server = await preview({ preview: { port: 5183, strictPort: true }, logLevel: 'error' });
const browser = await launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// Start as a champion so every taw is unlocked, on ultra glass.
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('ringer3d.story.v1', JSON.stringify({ rung: 0, best: 8, champion: true }));
    localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: 'high', soundOn: false }));
  } catch {
    /* about:blank has no storage */
  }
});
const page = await ctx.newPage();
collectErrors(page, errors, 'visual');
page.on('crash', () => errors.push('visual: PAGE CRASHED'));
browser.on('disconnected', () => say('browser disconnected'));
const shot = (n) => page.screenshot({ path: join(out, `${n}.png`) });
try {
  await page.goto('http://localhost:5183/');
  await page.waitForFunction(() => !!window.__ringer, null, { timeout: 60000 });
  await page.waitForTimeout(3000);
  await shot('01-home');

  await page.getByText('Your taw').click();
  await page.waitForTimeout(2500);
  const count = await page.evaluate(() => window.__ringer.taws().length);
  say('taws', count);
  for (let i = 0; i < count; i++) {
    const name = await page.locator('.taw-name').textContent();
    await page.waitForTimeout(1200);
    await page.locator('.taw-view').screenshot({ path: join(out, `02-taw-${String(i).padStart(2, '0')}.png`) });
    say('taw', i, name);
    await page.getByLabel('Next taw').click();
  }
  await page.getByRole('button', { name: 'Use this taw' }).click();
  if (process.argv.includes('--taws')) throw 'done';

  // Versus screen against the Taw King.
  await page.evaluate(() => window.__ringer.versus(7));
  await page.waitForTimeout(1800);
  await shot('03-versus');

  // Close-ups in each field: put the camera low over the cross.
  for (const arena of ['schoolyard', 'rooftop', 'parlour', 'courtyard']) {
    await page.evaluate((a) => {
      const app = window.__ringer;
      app.quick = { opponent: 'regular', arena: a, majority: false, lag: false };
      app.playQuick();
    }, arena);
    await waitFor(page, (i) => i?.awaitingLocal, 30000, `arena ${arena}`);
    await page.waitForTimeout(2500);
    await shot(`04-${arena}-aim`);
    await page.evaluate(() => {
      const s = window.__ringer.scene;
      // Low and close over the cross, the way you would kneel to look at it.
      s.frame('showcase');
      s.userZoom = 0.22;
    });
    await page.waitForTimeout(3500);
    await shot(`05-${arena}-closeup`);
  }
} catch (e) {
  if (e !== 'done') errors.push(`visual: ${e.message}`);
  await shot('zz-failure').catch(() => {});
}
await browser.close();
await server.close();
say('errors', errors);
writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
process.exit(errors.length ? 1 : 0);
