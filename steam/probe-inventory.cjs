// Live check of the Steam Inventory bridge (inventory.cjs) with no window:
//   electron probe-inventory.cjs      (Steam running and logged in; App ID from steam_appid.txt)
// On App 480 (Spacewar) itemdef 10 is a playtime drop list anyone may trigger.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const steamworks = require('steamworks.js');

const out = process.env.PROBE_OUT || path.join(__dirname, 'probe-inventory.json');
const report = { at: new Date().toISOString(), steps: {} };
const step = async (name, fn) => {
  try {
    report.steps[name] = { ok: true, value: await fn() };
  } catch (e) {
    report.steps[name] = { ok: false, error: String(e && e.message ? e.message : e) };
  }
};

app.whenReady().then(async () => {
  const appId = Number(process.env.STEAM_APP_ID || fs.readFileSync(path.join(__dirname, 'steam_appid.txt'), 'utf8').trim() || 480);
  await step('init', () => (steamworks.init(appId), { appId }));
  let inv = null;
  await step('bridge', () => ((inv = require('./inventory.cjs').createInventory()), true));
  if (inv) {
    // Item definitions load asynchronously: ask, give Steam a moment, ask again.
    await step('defs', async () => {
      inv.defs();
      await new Promise((r) => setTimeout(r, 3000));
      return inv.defs().slice(0, 12);
    });
    await step('before', async () => (await inv.all()).map((i) => ({ itemId: i.itemId, def: i.def, qty: i.qty })));
    await step('drop', async () => (await inv.drop(Number(process.env.DROP_DEF || 10))).map((i) => ({ itemId: i.itemId, def: i.def })));
    await step('after', async () => (await inv.all()).length);
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  app.exit(0);
});
