// Create the game passes, developer products and badges from roblox/store/listing.json, with
// their images, through the Creator Hub's own APIs and the browser session. Idempotent: lists
// what exists first and only creates what is missing (matched by name). Writes the ids to
// roblox/store/ids.json. Logs no headers or cookies.
const fs = require('fs');
const path = require('path');
const U = 10773508905;
const ROOT = 'D:/agent-work/ringer3d/main-review/roblox/store';
const ART = 'D:/agent-work/ringer3d/roblox-art/icons';

module.exports = async (ctx, page, out, log) => {
  const listing = JSON.parse(fs.readFileSync(path.join(ROOT, 'listing.json'), 'utf8'));
  const idsFile = path.join(ROOT, 'ids.json');
  const ids = fs.existsSync(idsFile) ? JSON.parse(fs.readFileSync(idsFile, 'utf8')) : { passes: {}, products: {}, badges: {} };
  await page.goto(`https://create.roblox.com/dashboard/creations/experiences/${U}/monetization/passes`);
  await page.waitForTimeout(3000);
  let token = null;
  const call = async (method, url, opts = {}) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.fetch(url, { method, ...opts, headers: { ...(opts.headers || {}), ...(token ? { 'x-csrf-token': token } : {}) } });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: r.status(), json, text };
    }
  };
  const image = (name) => ({ name: name + '.png', mimeType: 'image/png', buffer: fs.readFileSync(path.join(ART, name + '.png')) });

  // ---- Game passes
  const passList = await call('GET', `https://apis.roblox.com/game-passes/v1/universes/${U}/game-passes/creator?pageSize=400`);
  const passes = (passList.json && (passList.json.gamePasses || passList.json.data)) || [];
  log('existing passes', passes.length, passList.status);
  for (const [key, p] of Object.entries(listing.passes)) {
    let found = passes.find((x) => (x.name || x.Name) === p.name);
    let id = found && (found.gamePassId || found.id);
    if (!id) {
      const r = await call('POST', `https://apis.roblox.com/game-passes/v1/universes/${U}/game-passes`, {
        multipart: { name: p.name, description: p.description, imageFile: image('pass-' + key), isForSale: 'true', price: String(p.price) },
      });
      log('create pass', key, r.status, r.text.slice(0, 300));
      id = r.json && (r.json.gamePassId || r.json.id);
    }
    if (id) ids.passes[key] = Number(id);
  }

  // ---- Developer products
  const prodList = await call('GET', `https://apis.roblox.com/developer-products/v2/universes/${U}/developer-products/creator?pageSize=400&pageToken=`);
  const prods = (prodList.json && (prodList.json.developerProducts || prodList.json.data)) || [];
  log('existing products', prods.length, prodList.status);
  for (const [key, p] of Object.entries(listing.products)) {
    let found = prods.find((x) => (x.name || x.Name) === p.name);
    let id = found && (found.productId || found.id);
    if (!id) {
      const r = await call('POST', `https://apis.roblox.com/developer-products/v2/universes/${U}/developer-products`, {
        multipart: { name: p.name, description: p.description, price: String(p.price), isForSale: 'true', imageFile: image('prod-' + key) },
      });
      log('create product', key, r.status, r.text.slice(0, 300));
      id = r.json && (r.json.productId || r.json.id);
    }
    if (id) ids.products[key] = Number(id);
  }

  // ---- Badges (the first five a day are free; expectedCost 0 refuses to spend Robux)
  const badgeList = await call('GET', `https://badges.roblox.com/v1/universes/${U}/badges?limit=100&sortOrder=Asc`);
  const badges = (badgeList.json && badgeList.json.data) || [];
  log('existing badges', badges.length, badgeList.status);
  for (const [key, b] of Object.entries(listing.badges)) {
    let found = badges.find((x) => x.name === b.name);
    let id = found && found.id;
    if (!id) {
      const r = await call('POST', `https://badges.roblox.com/v1/universes/${U}/badges`, {
        multipart: { name: b.name, description: b.description, paymentSourceType: '1', expectedCost: '0', isActive: 'true', files: image('badge-' + key) },
      });
      log('create badge', key, r.status, r.text.slice(0, 300));
      id = r.json && r.json.id;
    }
    if (id) ids.badges[key] = Number(id);
  }

  fs.writeFileSync(idsFile, JSON.stringify(ids, null, 2) + '\n');
  log('ids', JSON.stringify(ids));
};
