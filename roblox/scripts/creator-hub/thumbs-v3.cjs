// Game page round 3 (2026-11-17): the icon and seven in-game thumbnails from the Studio shot rig.
// Uploads all of them first; the old thumbnails are deleted only if every new one went up.
const fs = require('fs');
const U = 10773508905;
const ART = 'D:/agent-work/ringer3d/2026-11-16-page-shots/page';
const THUMBS = [
  ['1-race.jpg', 'A glass marble racing down Marble Mountain with two ghost marbles behind it'],
  ['2-duel.jpg', 'The opening cross of thirteen marbles in the ring on the grass field'],
  ['3-auras.jpg', 'Players glowing with sparkle, fire and light auras'],
  ['4-air.jpg', 'A marble in mid-air over a jump, the track looping below'],
  ['5-fields.jpg', 'A duel in play on the cracked ice field'],
  ['6-finish.jpg', 'A marble crossing the finish line between crowds of marble fans'],
  ['7-collect.jpg', 'The lobby showcase of rare marbles with their rarities and prices'],
];

module.exports = async (ctx, page, out, log) => {
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

  const media = await call('GET', `https://games.roblox.com/v2/games/${U}/media?cb=${Date.now()}`);
  const old = (media.json?.data || []).map((m) => m.imageId || m.id).filter(Boolean);
  log('old', JSON.stringify(old));
  fs.writeFileSync(`${out}/old-media.json`, JSON.stringify(media.json, null, 1));

  log('icon', JSON.stringify(await call('POST', `https://publish.roblox.com/v1/games/${U}/icon`, { multipart: { 'request.files': file('icon.png', 'image/png') } })));

  const fresh = [];
  for (const [name] of THUMBS) {
    const r = await call('POST', `https://publish.roblox.com/v1/games/${U}/thumbnail/image`, { multipart: { 'request.files': file(name, 'image/jpeg') } });
    log('upload', name, r.status, r.text);
    if (r.json?.targetId) fresh.push({ id: r.json.targetId, name });
  }
  fs.writeFileSync(`${out}/thumb-ids.json`, JSON.stringify(fresh, null, 1));
  if (fresh.length !== THUMBS.length) {
    log('NOT deleting the old thumbnails: only', fresh.length, 'of', THUMBS.length, 'uploaded');
    return;
  }
  for (const id of old) log('delete', id, (await call('DELETE', `https://develop.roblox.com/v1/universes/${U}/thumbnails/${id}`)).status);
  log('order', JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/order`, json({ thumbnailIds: fresh.map((f) => f.id) }))));
  const alt = Object.fromEntries(THUMBS);
  for (const f of fresh) {
    log('alt', f.name, JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/alt-text`, json({ MediaAssetId: f.id, MediaAssetAltText: alt[f.name] }))));
  }
  const after = await call('GET', `https://games.roblox.com/v2/games/${U}/media?cb=${Date.now()}`);
  for (const m of after.json?.data || []) log('media', JSON.stringify(m).slice(0, 200));
};
