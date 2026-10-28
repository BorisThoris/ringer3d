// Check the experience's privacy and make it public (RINGER_GO_PUBLIC=1) through the Creator Hub API.
module.exports = async (ctx, page, out, log) => {
  const U = 10773508905;
  await page.goto(`https://create.roblox.com/dashboard/creations/experiences/${U}/overview`);
  await page.waitForTimeout(4000);
  let token = null;
  const call = async (method, url) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.fetch(url, { method, headers: token ? { 'x-csrf-token': token } : {} });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      return { status: r.status(), text: (await r.text()).slice(0, 400) };
    }
  };
  const before = await call('GET', `https://develop.roblox.com/v1/universes/${U}`);
  log('before', before.text);
  if (process.env.RINGER_GO_PUBLIC === '1') {
    log('activate', JSON.stringify(await call('POST', `https://develop.roblox.com/v1/universes/${U}/activate`)));
    log('after', (await call('GET', `https://develop.roblox.com/v1/universes/${U}`)).text);
  }
  log('public page', (await call('GET', `https://games.roblox.com/v1/games?universeIds=${U}`)).text);
};
