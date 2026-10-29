// Everything the game asks of Steam, in one object, with no window involved: the Electron shell
// (main.cjs) serves it to the game over IPC, and node-bridge.cjs hands it straight to Node code
// (the headless CLI, agents, tests against a live Steam). Built on steamworks.js, plus the flat
// API through koffi for what steamworks.js lacks (inventory.cjs, social.cjs).
const steamworks = require('steamworks.js');
const { initSteam, stopSteam } = require('./pump.cjs');

const LOBBY_TYPE = { private: 0, friends: 1, public: 2 };
const DIALOG = { friends: 0, community: 1, players: 2, settings: 3, stats: 5, achievements: 6 };
const RELIABLE = 2;
const CALLBACK = { LobbyChatUpdate: 5, P2PSessionRequest: 6, GameLobbyJoinRequested: 8, MicroTxnAuthorizationResponse: 9 };

const id64 = (p) => (p && p.steamId64 !== undefined ? p.steamId64 : p).toString();

/**
 * Initialise Steam for `appId` and build the API. `emit(event)` receives Steam's pushes:
 * { type: 'p2p', from, text } | { type: 'lobby', lobby, user, change } | { type: 'join', lobby, friend }
 * | { type: 'microtxn', order, authorized }. Returns { ok, error, api, stop }.
 */
function createSteamApi(appId, emit = () => {}) {
  let client;
  try {
    client = initSteam(appId);
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e), api: null, stop() {} };
  }

  const lobbies = new Map(); // id -> Lobby
  const keep = (lobby) => {
    lobbies.set(lobby.id.toString(), lobby);
    return lobby.id.toString();
  };
  // Made on first use, so a missing native piece only breaks its own calls.
  let inventory = null;
  let social = null;
  const inv = () => (inventory ??= require('./inventory.cjs').createInventory());
  const soc = () => (social ??= require('./social.cjs').createSocial());

  const api = {
    me: () => ({
      steamId: id64(client.localplayer.getSteamId()),
      name: client.localplayer.getName(),
      deck: client.utils.isSteamRunningOnSteamDeck(),
      language: client.apps.currentGameLanguage(),
      level: client.localplayer.getLevel(),
      country: client.localplayer.getIpCountry(),
    }),
    // Lobbies and P2P (ISteamMatchmaking, ISteamNetworking)
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
    // Achievements and stats (ISteamUserStats). steamworks.js can't list an app's achievements:
    // the game names them, Steam says which are unlocked.
    unlock: (name) => client.achievement.activate(name),
    achievements: (names) => (Array.isArray(names) ? names : []).filter((n) => client.achievement.isActivated(String(n))),
    statGet: (name) => client.stats.getInt(name),
    statSet: (name, v) => client.stats.setInt(name, v),
    statsStore: () => client.stats.store(),
    // Leaderboards, friends, the timeline (social.cjs)
    submitScore: (board, score, keepBest = true) => soc().submitScore(board, score, keepBest),
    scores: (board, scope, start, end) => soc().scores(board, scope, start, end),
    friends: () => soc().friends(),
    showUser: (steamId, dialog) => soc().showUser(steamId, dialog),
    timelineEvent: (title, desc, icon, priority) => soc().timelineEvent(title, desc, icon, priority),
    timelineState: (desc) => soc().timelineState(desc),
    timelineMode: (mode) => soc().timelineMode(mode),
    // Steam Cloud, rich presence, the overlay
    cloudRead: (file) => (client.cloud.isEnabledForApp() && client.cloud.fileExists(file) ? client.cloud.readFile(file) : null),
    cloudWrite: (file, text) => client.cloud.isEnabledForApp() && client.cloud.writeFile(file, text),
    presence: (key, value) => client.localplayer.setRichPresence(key, value ?? undefined),
    overlay: (d) => client.overlay.activateDialog(DIALOG[d] ?? 0),
    // Steam Inventory (inventory.cjs)
    invAll: () => inv().all(),
    invDrop: (listDef) => inv().drop(Number(listDef)),
    invExchange: (gen, destroy) => inv().exchange(gen.map(Number), destroy.map(String)),
    invConsume: (itemId) => inv().consume(String(itemId)),
    invBuy: (defs) => inv().buy(defs.map(Number)),
    invDefs: () => inv().defs(),
    invSetProps: (sets) => inv().setProps(sets),
    // A ticket for our server to check with ISteamUserAuth (store purchases)
    webApiTicket: async (identity) => {
      try {
        return (await client.auth.getAuthTicketForWebApi(identity)).getBytes().toString('hex');
      } catch {
        return null;
      }
    },
  };

  // Anyone in our lobby may open a P2P session to us.
  const handles = [
    client.callback.register(CALLBACK.P2PSessionRequest, ({ remote }) => client.networking.acceptP2PSession(remote)),
    client.callback.register(CALLBACK.LobbyChatUpdate, (u) =>
      emit({ type: 'lobby', lobby: u.lobby.toString(), user: u.user_changed.toString(), change: u.member_state_change === 0 ? 'entered' : 'left' }),
    ),
    client.callback.register(CALLBACK.GameLobbyJoinRequested, (j) => emit({ type: 'join', lobby: j.lobby_steam_id.toString(), friend: j.friend_steam_id.toString() })),
    client.callback.register(CALLBACK.MicroTxnAuthorizationResponse, (m) => emit({ type: 'microtxn', order: m.order_id.toString(), authorized: m.authorized })),
  ];
  // Read P2P packets as they arrive.
  const pump = setInterval(() => {
    let n;
    while ((n = client.networking.isP2PPacketAvailable()) > 0) {
      const p = client.networking.readP2PPacket(n);
      emit({ type: 'p2p', from: id64(p.steamId), text: p.data.toString('utf8') });
    }
  }, 8);

  return {
    ok: true,
    error: null,
    api,
    stop() {
      clearInterval(pump);
      stopSteam();
      for (const h of handles) h.disconnect();
      for (const l of lobbies.values()) l.leave();
      lobbies.clear();
    },
  };
}

module.exports = { createSteamApi, steamworks };
