// The store page as Roblox serves it: name, description start, genre, item names.
module.exports = async (ctx, page, out, log) => {
  const U = 10773508905;
  const g = (await (await ctx.request.get(`https://games.roblox.com/v1/games?universeIds=${U}&cb=${Date.now()}`)).json()).data[0];
  log('name', g.name);
  log('genre', g.genre_l1, '/', g.genre_l2);
  log('description', JSON.stringify(g.description.slice(0, 160)));
  const passes = await (await ctx.request.get(`https://apis.roblox.com/game-passes/v1/universes/${U}/game-passes/creator?pageSize=50`)).json();
  log('passes', (passes.gamePasses || []).map((p) => p.name).join(' | '));
  const prods = await (await ctx.request.get(`https://apis.roblox.com/developer-products/v2/universes/${U}/developer-products/creator?pageSize=50&pageToken=`)).json();
  log('products', (prods.developerProducts || []).map((p) => p.name).join(' | '));
};
