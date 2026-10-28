// Store page round 2: title/description, icon, thumbnails (replace, order, alt text), pass and
// product names, badge text; logs the genre settings. Every call's status is logged.
const fs = require('fs');
const U = 10773508905;
const PLACE = 114836219465070;
const ART = 'D:/agent-work/ringer3d/roblox-art/final2';
const STORE = 'D:/agent-work/ringer3d/main-review/roblox/store';

module.exports = async (ctx, page, out, log) => {
  const listing = JSON.parse(fs.readFileSync(`${STORE}/listing.json`, 'utf8'));
  const ids = JSON.parse(fs.readFileSync(`${STORE}/ids.json`, 'utf8'));
  const alt = JSON.parse(fs.readFileSync(`${ART}/alt.json`, 'utf8'));
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
      return { status: r.status(), json, text: text.slice(0, 300) };
    }
  };
  const json = (data) => ({ headers: { 'content-type': 'application/json' }, data: JSON.stringify(data) });
  const file = (name, type) => ({ name, mimeType: type, buffer: fs.readFileSync(`${ART}/${name}`) });
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const want = (k) => !only || only.includes(k);

  if (want('text')) {
    log('place', (await call('PATCH', `https://develop.roblox.com/v2/places/${PLACE}`, json({ name: listing.name, description: listing.description }))).status);
    log('universe', (await call('PATCH', `https://develop.roblox.com/v2/universes/${U}/configuration`, json({ name: listing.name }))).status);
  }
  if (want('icon')) {
    log('icon', JSON.stringify(await call('POST', `https://publish.roblox.com/v1/games/${U}/icon`, { multipart: { 'request.files': file('icon-512.png', 'image/png') } })));
  }
  if (want('thumbs')) {
    const media = await call('GET', `https://games.roblox.com/v2/games/${U}/media`);
    const old = (media.json?.data || []).filter((m) => m.assetType === 'Image' || m.imageId).map((m) => m.imageId || m.id);
    log('old thumbnails', JSON.stringify(old));
    const fresh = [];
    for (const t of listing.thumbnails) {
      const r = await call('POST', `https://publish.roblox.com/v1/games/${U}/thumbnail/image`, { multipart: { 'request.files': file(t, 'image/jpeg') } });
      log('upload', t, r.status, r.text);
      if (r.json?.targetId) fresh.push({ id: r.json.targetId, name: t });
    }
    for (const id of old) log('delete', id, (await call('DELETE', `https://develop.roblox.com/v1/universes/${U}/thumbnails/${id}`)).status);
    log('order', JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/order`, json({ thumbnailIds: fresh.map((f) => f.id) }))));
    for (const f of fresh) {
      log('alt', f.name, JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/${f.id}/alt-text`, json({ altText: alt[f.name] }))));
    }
    fs.writeFileSync(`${out}/thumb-ids.json`, JSON.stringify(fresh, null, 1));
  }
  if (want('items')) {
    for (const [k, p] of Object.entries(listing.passes)) {
      const r = await call('PATCH', `https://apis.roblox.com/game-passes/v1/universes/${U}/game-passes/${ids.passes[k]}`, { multipart: { name: p.name, description: p.description } });
      log('pass', k, r.status, r.text);
    }
    for (const [k, p] of Object.entries(listing.products)) {
      const r = await call('PATCH', `https://apis.roblox.com/developer-products/v2/universes/${U}/developer-products/${ids.products[k]}`, { multipart: { name: p.name, description: p.description } });
      log('product', k, r.status, r.text);
    }
    for (const [k, b] of Object.entries(listing.badges)) {
      const r = await call('PATCH', `https://badges.roblox.com/v1/badges/${ids.badges[k]}`, json({ name: b.name, description: b.description, enabled: true }));
      log('badge', k, r.status, r.text);
    }
  }
  if (want('genre')) {
    const g = await call('GET', `https://apis.roblox.com/experience-genre-api/v1/Creator/ExperienceGenre?universeId=${U}&genreTaxonomyVersion=1&responseOptions.includeUpdateLockExpirationTime=true&responseOptions.includeCreatorGenreTaxonomy=true`);
    fs.writeFileSync(`${out}/genre.json`, JSON.stringify(g.json, null, 1));
    log('genre', g.status, g.text);
  }
};
