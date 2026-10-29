// Live check of headless Steam (node-bridge.cjs) from plain Node, no Electron, no window:
//   node steam/probe-headless.cjs [out.json]      (Steam running and logged in; App 480 by default)
// Spacewar (480) has a "Feet Traveled" leaderboard to read and write.
const fs = require('node:fs');
const path = require('node:path');
const { connectSteam } = require('./node-bridge.cjs');

const out = process.argv[2] || path.join(__dirname, 'probe-headless.json');
const report = { at: new Date().toISOString(), runtime: `node ${process.version}`, steps: {} };
const step = async (name, fn) => {
  try {
    report.steps[name] = { ok: true, value: await fn() };
  } catch (e) {
    report.steps[name] = { ok: false, error: String(e && e.message ? e.message : e) };
  }
};

(async () => {
  const steam = connectSteam();
  report.connected = !!steam;
  if (steam) {
    const board = process.env.BOARD || 'Feet Traveled';
    await step('me', () => steam.me());
    await step('friends', async () => {
      const f = await steam.friends();
      return { count: f.length, online: f.filter((x) => x.state !== 'offline').length, playing: f.filter((x) => x.appId).length };
    });
    await step('leaderboardTop', () => steam.scores(board, 'global', 1, 5));
    await step('submitScore', () => steam.submitScore(board, Number(process.env.SCORE || 1), true));
    await step('leaderboardAroundMe', () => steam.scores(board, 'around', -1, 1));
    await step('inventory', async () => (await steam.invAll()).map((i) => ({ itemId: i.itemId, def: i.def })));
    await step('timeline', async () => ({ mode: await steam.timelineMode(3), event: await steam.timelineEvent('Probe', 'headless Steam probe') }));
    await step('lobbyRoundTrip', async () => {
      const id = await steam.createLobby('private', 2);
      await steam.setLobbyData(id, { game: 'ringer3d-probe' });
      const data = await steam.lobbyData(id);
      await steam.leaveLobby(id);
      return { id, data: data.game };
    });
    steam.close();
  }
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  process.exit(0);
})();
