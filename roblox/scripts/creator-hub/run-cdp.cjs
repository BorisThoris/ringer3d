// Like fp-mods/publish/run.cjs, but for when the launcher profile is already held by a running
// headless Chrome: attach to it over CDP and use only its request API (HTTP with the profile's
// cookies). Opens no tabs, touches none of its pages, and disconnects without closing it.
//   node run-cdp.cjs <cdp url> STEPS.cjs OUTDIR
const path = require('path');
const fs = require('fs');
const { chromium } = require('D:/agent-work/playwright-browser/2026-10-22-desktop-launcher/node_modules/playwright-core');

(async () => {
  const [cdp, steps, out] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const log = (...a) => fs.appendFileSync(path.join(out, 'log.txt'), a.join(' ') + '\n');
  try {
    const browser = await chromium.connectOverCDP(cdp);
    const ctx = browser.contexts()[0];
    // Steps call page.goto/waitForTimeout only to warm up; here they are no-ops.
    const page = { goto: async () => {}, waitForTimeout: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 500))), screenshot: async () => {}, on: () => {} };
    await require(path.resolve(steps))(ctx, page, out, log);
    log('DONE');
  } catch (e) {
    log('ERROR', e.stack || e);
  }
  process.exit(0); // disconnect; never close a browser this script did not start
})();
