// run.cjs on a copy of the launcher profile (when another session holds it).   node run-copy.cjs STEPS.cjs OUTDIR PROFILE
// STEPS.cjs exports async (ctx, page, out, log) => {...}
const path = require('path');
const fs = require('fs');
const { chromium } = require('D:/agent-work/playwright-browser/2026-10-22-desktop-launcher/node_modules/playwright-core');

(async () => {
  const [steps, out, profile] = [process.argv[2], process.argv[3], process.argv[4]];
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => fs.appendFileSync(path.join(out, 'log.txt'), a.join(' ') + '\n');
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: true,
      viewport: { width: 1440, height: 1000 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    page.setDefaultTimeout(45000);
    await require(path.resolve(steps))(ctx, page, out, log);
    log('DONE');
  } catch (e) {
    log('ERROR', e.stack || e);
    try { await ctx.pages().slice(-1)[0].screenshot({ path: path.join(out, 'error.png') }); } catch {}
  }
  try { await ctx.close(); } catch {}
})();
