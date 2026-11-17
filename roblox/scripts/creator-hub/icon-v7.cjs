// Icon round 7 (2026-11-17): the chart layout (avatar big and close, holding the giant Mythic
// marble, warm sunburst). Built by keyart/icon2.py from the pass11 mythic beauty + matte.
const fs = require('fs');
const U = 10773508905;
const ICON = 'D:/agent-work/ringer3d/2026-11-17-keyart/icon2/c.png';

module.exports = async (ctx, page, out, log) => {
  let token = null;
  for (let i = 0; i < 2; i++) {
    const r = await ctx.request.fetch(`https://publish.roblox.com/v1/games/${U}/icon`, {
      method: 'POST',
      headers: token ? { 'x-csrf-token': token } : {},
      multipart: { 'request.files': { name: 'icon.png', mimeType: 'image/png', buffer: fs.readFileSync(ICON) } },
    });
    if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
      token = r.headers()['x-csrf-token'];
      continue;
    }
    log('icon', r.status(), (await r.text()).slice(0, 300));
    break;
  }
};
