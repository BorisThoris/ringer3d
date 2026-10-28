// Create one Open Cloud API key, scoped to the Ringer 3D experience only (publish places, run
// Luau test sessions), restricted to this PC's public IP, expiring in 90 days. The secret is
// written straight to a file outside the repo and never logged.
const fs = require('fs');
const UNIVERSE = '10773508905';
const KEY_FILE = 'D:/agent-work/ringer3d/roblox-secrets/opencloud.key';
module.exports = async (ctx, page, out, log) => {
  if (fs.existsSync(KEY_FILE)) return log('key file already exists; not creating another');
  const trace = await (await ctx.request.get('https://1.1.1.1/cdn-cgi/trace')).text();
  const ip = (trace.match(/^ip=(.+)$/m) || [])[1];
  if (!ip || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return log('could not read public IPv4:', JSON.stringify(ip));
  await page.goto('https://create.roblox.com/dashboard/credentials?activeTab=ApiKeysTab');
  await page.waitForTimeout(3000);
  const expires = new Date(Date.now() + 90 * 864e5).toISOString();
  const body = {
    cloudAuthUserConfiguredProperties: {
      name: 'ringer3d-publish',
      description: 'Ringer 3D: publish places and run Luau test sessions (created by Claude for boristhoris)',
      isEnabled: true,
      allowedCidrs: [ip + '/32'],
      expirationTimeUtc: expires,
      scopes: [
        { scopeType: 'universe-places', targetParts: [UNIVERSE], operations: ['write'] },
        { scopeType: 'universe.place.luau-execution-session', targetParts: [UNIVERSE], operations: ['read', 'write'] },
      ],
    },
  };
  const post = (token) =>
    ctx.request.post('https://apis.roblox.com/cloud-authentication/v1/apiKey', {
      headers: { 'content-type': 'application/json', ...(token ? { 'x-csrf-token': token } : {}) },
      data: JSON.stringify(body),
    });
  let r = await post();
  if (r.status() === 403 && r.headers()['x-csrf-token']) r = await post(r.headers()['x-csrf-token']);
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  const secret = j && (j.apikeySecret || j.apiKeySecret);
  if (r.status() !== 200 || !secret) return log('create failed', r.status(), text.replace(/"api[kK]eySecret"\s*:\s*"[^"]*"/g, '"<hidden>"').slice(0, 600));
  fs.mkdirSync('D:/agent-work/ringer3d/roblox-secrets', { recursive: true });
  fs.writeFileSync(KEY_FILE, secret);
  log('created key', j.cloudAuthInfo && j.cloudAuthInfo.id, 'ip', ip, 'expires', expires, 'secret saved, length', secret.length);
};
