// Game page round 5 (2026-11-17): round 4 with sticker-outlined cutouts and sunbursts.`n// Round 4 (2026-11-17): key art in the charts' style (avatar hero, big gradient titles),
// rendered from the game's assets in Studio (2026-11-17-keyart) and composed by compose.py.
// Uploads all of them first; the old thumbnails are deleted only if every new one went up.
const fs = require('fs');
const U = 10773508905;
const ART = 'D:/agent-work/ringer3d/2026-11-17-keyart/page3';
// Upload ids of the round being replaced (the only ids delete accepts).
const PREVIOUS = 'D:/agent-work/ringer3d/roblox-publish/2026-11-17-thumbs-v4/thumb-ids.json';
const THUMBS = [
  ['1-duel.jpg', 'A smiling player reaching out to flick a marble in the duel ring'],
  ['2-mythic.jpg', 'A player holding up a giant glowing Black Hole Mythic marble'],
  ['3-aura.jpg', 'A player in a gold pillar of light: the server Main Character'],
  ['4-knockout.jpg', 'Marbles flying out of the ring around a player mid-flick'],
  ['5-race.jpg', 'A glass marble racing down Marble Mountain with ghost marbles'],
  ['6-air.jpg', 'A marble in mid-air over a jump, the track looping below'],
  ['7-fields.jpg', 'A duel in play on the cracked ice field'],
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
  // A body whose big ids must stay exact: written as JSON numbers from their digit strings.
  const raw = (text) => ({ headers: { 'content-type': 'application/json' }, data: text });
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
    const idm = /"targetId":\s*(\d+)/.exec(r.text || '');
    if (idm) fresh.push({ id: idm[1], name }); // a string: the id passes 2^53
  }
  fs.writeFileSync(`${out}/thumb-ids.json`, JSON.stringify(fresh, null, 1));
  if (fresh.length !== THUMBS.length) {
    log('NOT deleting the old thumbnails: only', fresh.length, 'of', THUMBS.length, 'uploaded');
    return;
  }
  // As strings: the ids pass 2^53, and JSON.parse rounds them.
  const prev = [...fs.readFileSync(PREVIOUS, 'utf8').matchAll(/"id":\s*(\d+)/g)].map((m) => m[1]);
  for (const id of prev) log('delete', id, (await call('DELETE', `https://develop.roblox.com/v1/universes/${U}/thumbnails/${id}`)).status);
  void old;
  log('order', JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/order`, raw(`{"thumbnailIds":[${fresh.map((f) => f.id).join(',')}]}`))));
  const alt = Object.fromEntries(THUMBS);
  for (const f of fresh) {
    log('alt', f.name, JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/alt-text`, raw(`{"MediaAssetId":${f.id},"MediaAssetAltText":${JSON.stringify(alt[f.name])}}`))));
  }
  const after = await call('GET', `https://games.roblox.com/v2/games/${U}/media?cb=${Date.now()}`);
  for (const m of after.json?.data || []) log('media', JSON.stringify(m).slice(0, 200));
};
