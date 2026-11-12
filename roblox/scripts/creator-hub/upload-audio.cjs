// Upload the game's sound sprite (roblox/audio/ringer-sfx.ogg, built from CC0 recordings and
// synthesis by build_sprite.py) as an Audio asset owned by the signed-in account, through the
// Creator Hub's own asset API, then give the experience permission to play it. Writes the asset
// id into store/ids.json under "audio.sfx". Set AUDIO_FORCE=1 to upload a new version anyway.
const fs = require('fs');
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
  let assetId = ids.audio && ids.audio.sfx;
  if (!assetId || process.env.AUDIO_FORCE) {
    const file = fs.readFileSync(path.join(ROOT, 'audio/ringer-sfx.ogg'));
    const request = {
      assetType: 'Audio',
      displayName: 'Ringer 3D sound effects',
      description: 'Marble clacks, surface contacts, rolling, chimes and pads for Ringer 3D (Kenney Impact Sounds, CC0, plus synthesis).',
      creationContext: { creator: { userId: String(me.id) } },
    };
    const r = await call('https://apis.roblox.com/assets/user-auth/v1/assets', {
      method: 'POST',
      multipart: { request: JSON.stringify(request), fileContent: { name: 'ringer-sfx.ogg', mimeType: 'audio/ogg', buffer: file } },
    });
    const text = await r.text();
    log('upload', r.status(), text.slice(0, 400));
    if (r.status() !== 200) return;
    let op = JSON.parse(text);
    for (let i = 0; i < 60 && !op.done; i++) {
      await new Promise((res) => setTimeout(res, 3000));
      const p = op.path || `operations/${op.operationId}`;
      op = await (await call(`https://apis.roblox.com/assets/user-auth/v1/${p}`)).json();
    }
    log('operation', JSON.stringify(op).slice(0, 500));
    assetId = op.response && op.response.assetId;
    if (!assetId) return log('no asset id');
    ids.audio = { ...(ids.audio || {}), sfx: Number(assetId) };
    fs.writeFileSync(idsFile, JSON.stringify(ids, null, 2) + '\n');
    log('asset', assetId);
  }
  // Let the experience use the asset (uploads by the experience owner usually are, but say so).
  const g = await call(`https://apis.roblox.com/asset-permissions-api/v1/assets/permissions`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    data: JSON.stringify({ subjectType: 'Universe', subjectId: UNIVERSE, action: 'Use', enableDeepAccessCheck: false, requests: [{ assetId: Number(assetId) }] }),
  });
  log('permission', g.status(), (await g.text()).slice(0, 300));
};
