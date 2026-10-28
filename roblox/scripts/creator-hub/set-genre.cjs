// Set the experience's genre (Sports & Racing > Sports, like 8 Ball Duels). Tries the likely
// request shapes and logs each answer; reads the setting back.
module.exports = async (ctx, page, out, log) => {
  const U = 10773508905;
  const base = 'https://apis.roblox.com/experience-genre-api/v1/Creator/ExperienceGenre';
  let token = null;
  const call = async (method, url, data) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.fetch(url, { method, headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) }, data: data ? JSON.stringify(data) : undefined });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      return `${r.status()} ${(await r.text()).slice(0, 300)}`;
    }
  };
  for (const [method, genre] of [['PATCH', 'sports'], ['POST', 'sports'], ['PATCH', 'Sports']]) {
    const res = await call(method, base, { universeId: U, genre, genreTaxonomyVersion: 1 });
    log(method, genre, res);
    if (res.startsWith('200') || res.startsWith('204')) break;
  }
  log('now', await call('GET', `${base}?universeId=${U}&genreTaxonomyVersion=1&responseOptions.includeCreatorSelectedGenre=true`));
};
