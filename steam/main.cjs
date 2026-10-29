// Ringer 3D for Steam: the web build in an Electron window, with Steamworks in the main
// process (steamworks.js). The game reaches Steam only through the bridge in preload.cjs
// (window.steam, typed in src/steam.ts); every call lands in `api` below.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const steamworks = require('steamworks.js');

// The App ID: STEAM_APP_ID, else the one Steam passes when it launches the game (SteamAppId),
// else steam_appid.txt next to this file (480 = Valve's test app, for development).
const APP_ID = Number(process.env.STEAM_APP_ID || process.env.SteamAppId || readText(path.join(__dirname, 'steam_appid.txt')) || 480);
// The game: a packaged copy in ./app, or the repo's web build while developing.
// Packaged: the copy `npm run pack` made. Development: the fresh build (app/ may be a stale pack copy).
const DIST = app.isPackaged ? path.join(__dirname, 'app') : path.join(__dirname, '..', 'dist');

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
}

// A released build must be started by Steam; outside Steam, ask Steam to relaunch it.
if (app.isPackaged && APP_ID !== 480 && steamworks.restartAppIfNecessary(APP_ID)) app.exit(0);

let client = null;
let initError = null;
try {
  client = steamworks.init(APP_ID);
} catch (e) {
  initError = String(e && e.message ? e.message : e);
}

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const id64 = (p) => (p && p.steamId64 !== undefined ? p.steamId64 : p).toString();
const lobbies = new Map(); // id -> Lobby
const LOBBY_TYPE = { private: 0, friends: 1, public: 2 };
const DIALOG = { friends: 0, community: 1, players: 2, settings: 3, stats: 5, achievements: 6 };
const RELIABLE = 2;

// Steam Inventory through koffi (inventory.cjs), made on first use.
let inventory = null;
const inv = () => (inventory ??= require('./inventory.cjs').createInventory());

const keep = (lobby) => {
  lobbies.set(lobby.id.toString(), lobby);
  return lobby.id.toString();
};

const api = {
  me: () => ({
    steamId: id64(client.localplayer.getSteamId()),
    name: client.localplayer.getName(),
    deck: client.utils.isSteamRunningOnSteamDeck(),
    language: client.apps.currentGameLanguage(),
  }),
  createLobby: async (kind, max) => keep(await client.matchmaking.createLobby(LOBBY_TYPE[kind] ?? 2, max)),
  joinLobby: async (id) => keep(await client.matchmaking.joinLobby(BigInt(id))),
  listLobbies: async () =>
    (await client.matchmaking.getLobbies()).map((l) => ({ id: l.id.toString(), data: l.getFullData(), members: Number(l.getMemberCount()), max: Number(l.getMemberLimit() ?? 0) })),
  leaveLobby: (id) => {
    lobbies.get(id)?.leave();
    lobbies.delete(id);
  },
  setLobbyData: (id, data) => lobbies.get(id)?.mergeFullData(data) ?? false,
  lobbyData: (id) => lobbies.get(id)?.getFullData() ?? {},
  lobbyMembers: (id) => (lobbies.get(id)?.getMembers() ?? []).map(id64),
  lobbyOwner: (id) => id64(lobbies.get(id)?.getOwner()),
  setJoinable: (id, b) => void lobbies.get(id)?.setJoinable(b),
  inviteFriends: (id) => client.overlay.activateInviteDialog(BigInt(id)),
  sendP2P: (steamId, text) => client.networking.sendP2PPacket(BigInt(steamId), RELIABLE, Buffer.from(text, 'utf8')),
  unlock: (name) => client.achievement.activate(name),
  // steamworks.js can't list an app's achievements; the game names them, Steam says which are unlocked.
  achievements: (names) => (Array.isArray(names) ? names : []).filter((n) => client.achievement.isActivated(String(n))),
  statGet: (name) => client.stats.getInt(name),
  statSet: (name, v) => client.stats.setInt(name, v),
  statsStore: () => client.stats.store(),
  cloudRead: (file) => (client.cloud.isEnabledForApp() && client.cloud.fileExists(file) ? client.cloud.readFile(file) : null),
  cloudWrite: (file, text) => client.cloud.isEnabledForApp() && client.cloud.writeFile(file, text),
  presence: (key, value) => client.localplayer.setRichPresence(key, value ?? undefined),
  overlay: (d) => client.overlay.activateDialog(DIALOG[d] ?? 0),
  invAll: () => inv().all(),
  invDrop: (listDef) => inv().drop(Number(listDef)),
  invExchange: (gen, destroy) => inv().exchange(gen.map(Number), destroy.map(String)),
  invConsume: (itemId) => inv().consume(String(itemId)),
  invBuy: (defs) => inv().buy(defs.map(Number)),
  invDefs: () => inv().defs(),
  invSetProps: (sets) => inv().setProps(sets),
  webApiTicket: async (identity) => {
    try {
      return (await client.auth.getAuthTicketForWebApi(identity)).getBytes().toString('hex');
    } catch {
      return null;
    }
  },
};

ipcMain.on('steam:status', (e) => {
  e.returnValue = { ok: !!client, appId: APP_ID, error: initError };
});
ipcMain.handle('steam', async (_e, method, args) => {
  if (!client) throw new Error('Steam is not running');
  const fn = api[method];
  if (!fn) throw new Error(`no Steam call "${method}"`);
  return fn(...(args ?? []));
});

let win = null;
const emit = (ev) => win && !win.isDestroyed() && win.webContents.send('steam:event', ev);

if (client) {
  const { SteamCallback } = { SteamCallback: { LobbyChatUpdate: 5, P2PSessionRequest: 6, GameLobbyJoinRequested: 8, MicroTxnAuthorizationResponse: 9 } };
  // Anyone in our lobby may open a P2P session to us.
  client.callback.register(SteamCallback.P2PSessionRequest, ({ remote }) => client.networking.acceptP2PSession(remote));
  client.callback.register(SteamCallback.LobbyChatUpdate, (u) =>
    emit({ type: 'lobby', lobby: u.lobby.toString(), user: u.user_changed.toString(), change: u.member_state_change === 0 ? 'entered' : 'left' }),
  );
  client.callback.register(SteamCallback.GameLobbyJoinRequested, (j) => emit({ type: 'join', lobby: j.lobby_steam_id.toString(), friend: j.friend_steam_id.toString() }));
  client.callback.register(SteamCallback.MicroTxnAuthorizationResponse, (m) => emit({ type: 'microtxn', order: m.order_id.toString(), authorized: m.authorized }));
  // Read P2P packets as they arrive and hand them to the game.
  setInterval(() => {
    let n;
    while ((n = client.networking.isP2PPacketAvailable()) > 0) {
      const p = client.networking.readP2PPacket(n);
      emit({ type: 'p2p', from: id64(p.steamId), text: p.data.toString('utf8') });
    }
  }, 8);
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#121a33',
    title: 'Ringer 3D',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false },
  });
  win.loadURL('app://ringer/index.html');
});

app.on('window-all-closed', () => app.quit());

// The Steam overlay (Shift+Tab) draws into the window.
if (client) steamworks.electronEnableSteamOverlay();
