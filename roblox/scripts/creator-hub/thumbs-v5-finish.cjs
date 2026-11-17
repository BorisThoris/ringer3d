// Round 5 finish (2026-11-17): the upload hit Roblox's rate limit after four images. The last
// three (race, air, fields) are unchanged from round 4 and already up, so keep those, delete
// round 4's first four, order the page, and give the new four their alt text.
// Ids are kept as digit strings and written raw (they pass 2^53).
const U = 10773508905;
const NEW = [
  ['7332489437186282', 'A smiling player reaching out to flick a marble in the duel ring'],
  ['6311916960185439', 'A player holding up a giant glowing Black Hole Mythic marble'],
  ['6435997331567651', 'A player in a gold pillar of light: the server Main Character'],
  ['5034640734460528', 'Marbles flying out of the ring around a player mid-flick'],
];
const KEEP = ['5035410775834632', '8035217976397544', '6775411549632585']; // round 4: race, air, fields
const DROP = ['6862914691592402', '8239045932270545', '6069268452352930', '7180014594340696']; // round 4: 1-4

module.exports = async (ctx, page, out, log) => {
  let token = null;
  const call = async (method, url, body) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) }, ...(body ? { data: body } : {}) });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      return `${r.status()} ${(await r.text()).slice(0, 160)}`;
    }
  };
  for (const id of DROP) log('delete', id, await call('DELETE', `https://develop.roblox.com/v1/universes/${U}/thumbnails/${id}`));
  const order = [...NEW.map((n) => n[0]), ...KEEP];
  log('order', await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/order`, `{"thumbnailIds":[${order.join(',')}]}`));
  for (const [id, text] of NEW) {
    log('alt', id, await call('POST', `https://develop.roblox.com/v1/universes/${U}/thumbnails/alt-text`, `{"MediaAssetId":${id},"MediaAssetAltText":${JSON.stringify(text)}}`));
  }
  const media = await (await ctx.request.get(`https://games.roblox.com/v2/games/${U}/media?cb=${Date.now()}`)).json();
  for (const m of media.data || []) log('media', m.imageId, m.approved, JSON.stringify(m.altText ?? '').slice(0, 50));
};
