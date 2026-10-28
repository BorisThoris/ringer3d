// Alt text for the detail-page thumbnails (the endpoint the Creator Hub uses).
const fs = require('fs');
module.exports = async (ctx, page, out, log) => {
  const U = 10773508905;
  const thumbs = JSON.parse(fs.readFileSync('D:/agent-work/ringer3d/roblox-publish/v2a/thumb-ids.json', 'utf8'));
  const alt = JSON.parse(fs.readFileSync('D:/agent-work/ringer3d/roblox-art/final2/alt.json', 'utf8'));
  let token = null;
  const post = async (url, data) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.post(url, { headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) }, data: JSON.stringify(data) });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      return `${r.status()} ${(await r.text()).slice(0, 200)}`;
    }
  };
  for (const t of thumbs) log(t.name, await post(`https://develop.roblox.com/v1/universes/${U}/thumbnails/alt-text`, { MediaAssetId: t.id, MediaAssetAltText: alt[t.name] }));
  const media = await (await ctx.request.get(`https://games.roblox.com/v2/games/${U}/media`)).json();
  for (const m of media.data || []) log('media', m.imageId, m.approved, JSON.stringify(m.altText ?? null).slice(0, 80));
};
