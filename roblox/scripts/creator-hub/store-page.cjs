// The experience's store page: name, description, devices, private servers, Studio API access,
// the icon and the thumbnails. Uses the Creator Hub's own APIs with the browser session.
const fs = require('fs');
const U = 10773508905;
const PLACE = 114836219465070;
const ART = 'D:/agent-work/ringer3d/roblox-art/icons';

module.exports = async (ctx, page, out, log) => {
  const listing = JSON.parse(fs.readFileSync('D:/agent-work/ringer3d/main-review/roblox/store/listing.json', 'utf8'));
  await page.goto(`https://create.roblox.com/dashboard/creations/experiences/${U}/configure`);
  await page.waitForTimeout(3000);
  let token = null;
  const call = async (method, url, opts = {}) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.fetch(url, { method, ...opts, headers: { ...(opts.headers || {}), ...(token ? { 'x-csrf-token': token } : {}) } });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      return { status: r.status(), text: (await r.text()).slice(0, 400) };
    }
  };
  const json = (data) => ({ headers: { 'content-type': 'application/json' }, data: JSON.stringify(data) });
  const img = (name, type = 'image/png') => ({ name: name.split('/').pop(), mimeType: type, buffer: fs.readFileSync(`${ART}/${name}`) });

  if (!process.env.SKIP_TEXT) {
    log('place name/desc', JSON.stringify(await call('PATCH', `https://develop.roblox.com/v2/places/${PLACE}`, json({ name: listing.name, description: listing.description }))));
    log('universe config', JSON.stringify(await call('PATCH', `https://develop.roblox.com/v2/universes/${U}/configuration`, json({
      name: listing.name,
      playableDevices: listing.devices,
      allowPrivateServers: true,
      privateServerPrice: 25,
      studioAccessToApisAllowed: true,
    }))));
  }
  if (!process.env.SKIP_ART) {
    log('icon', JSON.stringify(await call('POST', `https://publish.roblox.com/v1/games/${U}/icon`, { multipart: { 'request.files': img('icon-512.png') } })));
    for (const t of ['thumb-desk', 'thumb-boss', 'thumb-collection']) {
      log('thumbnail', t, JSON.stringify(await call('POST', `https://publish.roblox.com/v1/games/${U}/thumbnail/image`, { multipart: { 'request.files': img(t + '.jpg', 'image/jpeg') } })));
    }
  }
  const cfg = await call('GET', `https://develop.roblox.com/v1/universes/${U}/configuration`);
  log('config now', cfg.text);
};
