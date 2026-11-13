// Upload the game's audio as assets owned by the signed-in account, through the Creator Hub's own
// asset API, and give the experience permission to play them: the sound sprite (audio/ringer-sfx.ogg,
// build_sprite.py) and the music (audio/music-lobby.ogg, audio/music-match.ogg, ACE-Step). Ids go into
// store/ids.json under "audio". AUDIO_ITEMS picks which (default all); A file whose contents changed since its upload (ids.audioHash) is uploaded anew.
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const ROOT = 'D:/agent-work/ringer3d/play-store/roblox';
const UNIVERSE = '10773508905';
module.exports = async (ctx, page, out, log) => {
  const idsFile = path.join(ROOT, 'store/ids.json');
  const ids = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
  let token = null;
  const call = async (url, opts = {}) => {
    for (let i = 0; i < 2; i++) {
      const r = await ctx.request.fetch(url, { ...opts, headers: { ...(opts.headers || {}), ...(token ? { 'x-csrf-token': token } : {}) } });
      if (r.status() === 403 && r.headers()['x-csrf-token'] && r.headers()['x-csrf-token'] !== token) {
        token = r.headers()['x-csrf-token'];
        continue;
      }
      return r;
    }
  };
  const me = await (await call('https://users.roblox.com/v1/users/authenticated')).json();
  log('signed in as', me.name);
  const FILES = { sfx: 'audio/ringer-sfx.ogg', lobby: 'audio/music-lobby.ogg', match: 'audio/music-match.ogg' };
  const NAMES = { sfx: 'Ringer 3D sound effects', lobby: 'Ringer 3D lobby music', match: 'Ringer 3D match music' };
  const items = (process.env.AUDIO_ITEMS || 'sfx,lobby,match').split(',');
  for (const key of items) {
    const p = path.join(ROOT, FILES[key]);
    if (!fs.existsSync(p)) { log('no file for', key); continue; }
    let assetId = ids.audio && ids.audio[key];
    const hash = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
    const stale = !ids.audioHash || ids.audioHash[key] !== hash;
    if (!assetId || stale || process.env.AUDIO_FORCE) {
      const request = {
        assetType: 'Audio',
        displayName: NAMES[key],
        description: key === 'sfx' ? 'Marble clacks, surface contacts, rolling, chimes and pads for Ringer 3D (Kenney Impact Sounds, CC0, plus synthesis).' : 'Upbeat music for Ringer 3D, made with ACE-Step 1.5 (MIT).',
        creationContext: { creator: { userId: String(me.id) } },
      };
      const r = await call('https://apis.roblox.com/assets/user-auth/v1/assets', {
        method: 'POST',
        multipart: { request: JSON.stringify(request), fileContent: { name: path.basename(p), mimeType: 'audio/ogg', buffer: fs.readFileSync(p) } },
      });
      const text = await r.text();
      log(key, 'upload', r.status(), text.slice(0, 200));
      if (r.status() !== 200) continue;
      let op = JSON.parse(text);
      for (let i = 0; i < 60 && !op.done; i++) {
        await new Promise((res) => setTimeout(res, 3000));
        op = await (await call(`https://apis.roblox.com/assets/user-auth/v1/${op.path || 'operations/' + op.operationId}`)).json();
      }
      assetId = op.response && op.response.assetId;
      if (!assetId) { log(key, 'no asset id', JSON.stringify(op).slice(0, 300)); continue; }
      ids.audio = { ...(ids.audio || {}), [key]: Number(assetId) };
      ids.audioHash = { ...(ids.audioHash || {}), [key]: hash };
      fs.writeFileSync(idsFile, JSON.stringify(ids, null, 2) + '\n');
      log(key, 'asset', assetId);
    }
    const g = await call('https://apis.roblox.com/asset-permissions-api/v1/assets/permissions', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ subjectType: 'Universe', subjectId: UNIVERSE, action: 'Use', enableDeepAccessCheck: false, requests: [{ assetId: Number(assetId) }] }),
    });
    log(key, 'permission', g.status(), (await g.text()).slice(0, 200));
  }
};
