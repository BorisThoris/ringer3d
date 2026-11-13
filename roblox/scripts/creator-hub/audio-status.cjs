// Read the uploaded sound sprite's state on Roblox: moderation and whether the experience may use it.
const fs = require('fs');
const ids = JSON.parse(fs.readFileSync('D:/agent-work/ringer3d/play-store/roblox/store/ids.json', 'utf8'));
module.exports = async (ctx, page, out, log) => {
  for (const [key, id] of Object.entries(ids.audio)) {
    const r = await ctx.request.get(`https://apis.roblox.com/assets/user-auth/v1/assets/${id}?readMask=moderationResult,state,assetType,displayName`);
    log(key, id, r.status(), (await r.text()).slice(0, 300));
  }
};
