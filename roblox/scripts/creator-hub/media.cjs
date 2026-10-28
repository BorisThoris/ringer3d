// List the detail-page media as the owner sees it; DELETE=id1,id2 removes those first.
module.exports = async (ctx, page, out, log) => {
  const U = 10773508905;
  let token = null;
  const del = async (id) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.delete(`https://develop.roblox.com/v1/universes/${U}/thumbnails/${id}`, { headers: token ? { 'x-csrf-token': token } : {} });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      return `${r.status()} ${(await r.text()).slice(0, 150)}`;
    }
  };
  for (const id of (process.env.DELETE || '').split(',').filter(Boolean)) log('delete', id, await del(id));
  const media = await (await ctx.request.get(`https://games.roblox.com/v2/games/${U}/media?cb=${Date.now()}`)).json();
  for (const m of media.data || []) log('media', JSON.stringify(m).slice(0, 200));
};
