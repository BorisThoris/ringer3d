// Steam for plain Node, no Electron, no window: the same SteamBridge the game gets as
// window.steam (src/steam.ts), for the headless CLI, agents and live tests.
//   const { connectSteam } = require('./steam/node-bridge.cjs');
//   const steam = connectSteam(480);          // null if Steam isn't running / logged in
//   await steam.me(); steam.close();
// Steam must be running and logged in on this machine. steamworks.js and koffi load from steam/.
const fs = require('node:fs');
const path = require('node:path');
const { createSteamApi } = require('./api.cjs');

function appIdFrom(id) {
  if (id) return Number(id);
  if (process.env.STEAM_APP_ID) return Number(process.env.STEAM_APP_ID);
  try {
    return Number(fs.readFileSync(path.join(__dirname, 'steam_appid.txt'), 'utf8').trim()) || 480;
  } catch {
    return 480;
  }
}

function connectSteam(appId) {
  const id = appIdFrom(appId);
  const listeners = { p2p: new Set(), lobby: new Set(), join: new Set(), microtxn: new Set() };
  const steam = createSteamApi(id, (ev) => {
    for (const cb of listeners[ev.type] ?? []) {
      if (ev.type === 'p2p') cb(ev.from, ev.text);
      else if (ev.type === 'lobby') cb(ev.lobby, ev.user, ev.change);
      else if (ev.type === 'join') cb(ev.lobby, ev.friend);
      else if (ev.type === 'microtxn') cb(ev.order, ev.authorized);
    }
  });
  if (!steam.ok) return null;
  const listen = (kind) => (cb) => {
    listeners[kind].add(cb);
    return () => listeners[kind].delete(cb);
  };
  const bridge = {
    appId: id,
    onP2P: listen('p2p'),
    onLobbyChange: listen('lobby'),
    onJoinRequested: listen('join'),
    onMicroTxn: listen('microtxn'),
    /** Stop the P2P pump and leave lobbies, so the process can exit. */
    close: () => steam.stop(),
  };
  // Every call async, exactly as over the Electron IPC.
  for (const [name, fn] of Object.entries(steam.api)) bridge[name] = async (...args) => fn(...args);
  return bridge;
}

module.exports = { connectSteam };
