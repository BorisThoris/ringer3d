// Game page round 6 (2026-11-17): race, air and fields in the same cutout-and-sunburst style as
// round 5's first four (which stay). Uploads three (Roblox rate-limits after about four), then
// deletes round 4's race/air/fields by upload id and orders all seven. Ids stay digit strings.
const fs = require('fs');
const U = 10773508905;
const ART = 'D:/agent-work/ringer3d/2026-11-17-keyart/page4';
const UP = [
  ['5-race.jpg', 'A glass marble rushing down Marble Mountain with two ghost marbles behind'],
  ['6-air.jpg', 'A marble flying high over a jump, the track looping below'],
  ['7-fields.jpg', 'A player flicking marbles across the ice field'],
];
const FIRST = ['7332489437186282', '6311916960185439', '6435997331567651', '5034640734460528']; // round 5, kept
const DROP = ['5035410775834632', '8035217976397544', '6775411549632585']; // round 4: race, air, fields

module.exports = async (ctx, page, out, log) => {
  let token = null;
  const call = async (method, url, opts = {}) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.fetch(url, { method, ...opts, headers: { ...(opts.headers || {}), ...(token ? { 'x-csrf-token': token } : {}) } });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      return { status: r.status(), text: (await r.text()).slice(0, 300) };
    }
  };
  const raw = (text) => ({ headers: { 'content-type': 'application/json' }, data: text });
  const fresh = [];
  for (const [name, alt] of UP) {
    const r = await call('POST', `https://publish.roblox.com/v1/games/${U}/thumbnail/image`, { multipart: { 'request.files': { name, mimeType: 'image/jpeg', buffer: fs.readFileSync(`${ART}/${name}`) } } });
    log('upload', name, r.status, r.text);
    const m = /"targetId":\s*(\d+)/.exec(r.text || '');
    if (m) fresh.push({ id: m[1], name, alt });
  }
  fs.writeFileSync(`${out}/thumb-ids.json`, JSON.stringify(fresh, null, 1));
  if (fresh.length !== UP.length) {
    log('NOT replacing: only', fresh.length, 'of', UP.length, 'uploaded');
    return;
  }
  for (const id of DROP) log('delete', id, (await call('DELETE', `https://develop.roblox.com/v1/universes/${U}/thumbnails/${id}`)).status);
  const order = [...FIRST, ...fresh.map((f) => f.id)];
  log('order', JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/order`, raw(`{"thumbnailIds":[${order.join(',')}]}`))));
  for (const f of fresh) {
    log('alt', f.name, (await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/alt-text`, raw(`{"MediaAssetId":${f.id},"MediaAssetAltText":${JSON.stringify(f.alt)}}`))).status);
  }
  const media = await (await ctx.request.get(`https://games.roblox.com/v2/games/${U}/media?cb=${Date.now()}`)).json();
  for (const m of media.data || []) log('media', m.imageId, m.approved, JSON.stringify(m.altText ?? '').slice(0, 50));
};
