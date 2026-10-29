// Check the real Steamworks binding with no window: `npm run probe` (Steam must be running and
// logged in). Uses the App ID in steam_appid.txt (480 = Valve's test app). Prints one JSON
// report: identity, cloud, stats, achievements, a lobby round trip and a P2P send.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const steamworks = require('steamworks.js');

const out = process.env.PROBE_OUT || path.join(__dirname, 'probe.json');
const report = { at: new Date().toISOString(), steps: {} };
const step = async (name, fn) => {
  try {
    report.steps[name] = { ok: true, value: await fn() };
  } catch (e) {
    report.steps[name] = { ok: false, error: String(e && e.message ? e.message : e) };
  }
};

app.whenReady().then(async () => {
  const appId = Number(process.env.STEAM_APP_ID || fs.readFileSync(path.join(__dirname, 'steam_appid.txt'), 'utf8').trim() || 480);
  let c = null;
  await step('init', () => {
    c = steamworks.init(appId);
    return { appId };
  });
  if (c) {
    const me = c.localplayer.getSteamId();
    await step('identity', () => ({ steamId: me.steamId64.toString(), name: c.localplayer.getName(), deck: c.utils.isSteamRunningOnSteamDeck(), language: c.apps.currentGameLanguage() }));
    await step('cloud', () => {
      const ok = c.cloud.isEnabledForApp() && c.cloud.writeFile('probe.txt', 'ringer3d');
      return { enabled: c.cloud.isEnabledForApp(), wrote: ok, readBack: ok ? c.cloud.readFile('probe.txt') : null };
    });
    await step('stats', () => ({ get: c.stats.getInt('games_played') }));
    // App 480 (Spacewar) has its own achievements; ours exist only once the real app is set up.
    await step('achievements', () => Object.fromEntries(['ACH_WIN_ONE_GAME', 'FIRST_WIN'].map((n) => [n, c.achievement.isActivated(n)])));
    await step('statsRoundTrip', () => {
      const before = c.stats.getInt('NumGames');
      return { spacewarNumGames: before, set: before !== null && c.stats.setInt('NumGames', before), stored: c.stats.store() };
    });
    await step('lobby', async () => {
      const lobby = await c.matchmaking.createLobby(2, 2);
      lobby.mergeFullData({ game: 'ringer3d-probe', version: '0' });
      await new Promise((r) => setTimeout(r, 1500));
      const listed = (await c.matchmaking.getLobbies()).some((l) => l.id === lobby.id);
      const data = lobby.getFullData();
      lobby.leave();
      return { id: lobby.id.toString(), dataSet: data.game === 'ringer3d-probe', listedInSearch: listed };
    });
    await step('p2pToSelf', async () => {
      const sent = c.networking.sendP2PPacket(me.steamId64, 2, Buffer.from('ping'));
      await new Promise((r) => setTimeout(r, 1500));
      return { sent, loopedBack: c.networking.isP2PPacketAvailable() > 0 };
    });
    await step('richPresence', () => {
      c.localplayer.setRichPresence('status', 'Running the Ringer 3D probe');
      return true;
    });
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  app.exit(0);
});
