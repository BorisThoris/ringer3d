// Read the uploaded sound sprite's state on Roblox: moderation and whether the experience may use it.
const fs = require('fs');
const ids = JSON.parse(fs.readFileSync('D:/agent-work/ringer3d/play-store/roblox/store/ids.json', 'utf8'));
module.exports = async (ctx, page, out, log) => {
  const id = ids.audio.sfx;
  for (const url of [
    `https://apis.roblox.com/assets/user-auth/v1/assets/${id}?readMask=moderationResult,state,assetType,displayName`,
    `https://develop.roblox.com/v1/assets?assetIds=${id}`,
    `https://economy.roblox.com/v2/assets/${id}/details`,
  ]) {
    const r = await ctx.request.get(url);
    log(url.split('?')[0], r.status(), (await r.text()).slice(0, 500));
  }
};
