// Does each graphics quality render, and how fast, in software GL?
//   node scripts/probe-quality.mjs <outDir>
import { preview } from 'vite';
import { join } from 'node:path';
import { launch, logger } from './lib.mjs';

const out = process.argv[2] ?? 'probe-out';
const say = logger(out);
const server = await preview({ preview: { port: 5184, strictPort: true }, logLevel: 'error' });
const browser = await launch();
for (const quality of ['low', 'high']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript((q) => {
    try {
      localStorage.setItem('ringer3d.settings.v1', JSON.stringify({ quality: q, soundOn: false }));
    } catch {
      /* about:blank */
    }
  }, quality);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
  page.on('crash', () => logs.push('PAGE CRASHED'));
  try {
    await page.goto('http://localhost:5184/');
    await page.waitForFunction(() => !!window.__ringer, null, { timeout: 60000 });
    const fps = await page.evaluate(
      () =>
        new Promise((r) => {
          let n = 0;
          const t0 = performance.now();
          const f = () => (++n, performance.now() - t0 < 8000 ? requestAnimationFrame(f) : r(n / 8));
          requestAnimationFrame(f);
        }),
    );
    const gl = await page.evaluate(() => {
      const r = window.__ringer.scene.renderer;
      const g = r.getContext();
      return { lost: g.isContextLost(), programs: r.info.programs?.length, calls: r.info.render.calls, quality: window.__ringer.scene.getQuality() };
    });
    say(quality, 'fps', fps, gl);
    await page.screenshot({ path: join(out, `${quality}.png`) });
  } catch (e) {
    say(quality, 'FAILED', e.message.split('\n')[0]);
  }
  say(quality, 'logs', logs.filter((l) => !l.includes('deprecated parameters')).slice(0, 12));
  await ctx.close();
}
await browser.close();
await server.close();
