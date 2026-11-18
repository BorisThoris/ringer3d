// Game page round 7 (2026-11-18): a new Marble Duels image (keyart/duel3.py over the pass20 ring
// render): two marbles smashing mid-ring, dressed players kneeling round it. Uploads it, deletes
// round 5's duel by upload id, and puts the new one first. Ids stay digit strings (they pass 2^53).
const fs = require('fs');
const U = 10773508905;
const FILE = 'D:/agent-work/ringer3d/2026-11-17-keyart/icon2/duel3-h.jpg';
const ALT = 'Two glass marbles smashing together in a marble ring, players kneeling around it';
const REST = ['6311916960185439', '6435997331567651', '5034640734460528', '6130115191835091', '9436793176752201', '6064094803477492'];
const DROP = '7332489437186282'; // round 5 duel

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
  const r = await call('POST', `https://publish.roblox.com/v1/games/${U}/thumbnail/image`, { multipart: { 'request.files': { name: 'duel.jpg', mimeType: 'image/jpeg', buffer: fs.readFileSync(FILE) } } });
  log('upload', r.status, r.text);
  const m = /"targetId":\s*(\d+)/.exec(r.text || '');
  if (!m) {
    log('NOT replacing: upload failed');
    return;
  }
  const id = m[1];
  fs.writeFileSync(`${out}/thumb-id.json`, JSON.stringify({ id }));
  log('delete', DROP, (await call('DELETE', `https://develop.roblox.com/v1/universes/${U}/thumbnails/${DROP}`)).status);
  log('order', JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/order`, raw(`{"thumbnailIds":[${[id, ...REST].join(',')}]}`))));
  log('alt', (await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/alt-text`, raw(`{"MediaAssetId":${id},"MediaAssetAltText":${JSON.stringify(ALT)}}`))).status);
  const media = await (await ctx.request.get(`https://games.roblox.com/v2/games/${U}/media?cb=${Date.now()}`)).json();
  for (const x of media.data || []) log('media', x.imageId, x.approved, JSON.stringify(x.altText ?? '').slice(0, 50));
};
