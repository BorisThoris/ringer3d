// The game's only door to Steam: window.steam (the SteamBridge in src/steam.ts). Absent when
// Steam isn't running, so the game falls back to its non-Steam paths.
const { contextBridge, ipcRenderer } = require('electron');

const status = ipcRenderer.sendSync('steam:status');
if (status.ok) {
  const call = (method, ...args) => ipcRenderer.invoke('steam', method, args);
  const listeners = { p2p: new Set(), lobby: new Set(), join: new Set(), microtxn: new Set() };
  ipcRenderer.on('steam:event', (_e, ev) => {
    for (const cb of listeners[ev.type] ?? []) {
      try {
        if (ev.type === 'p2p') cb(ev.from, ev.text);
        else if (ev.type === 'lobby') cb(ev.lobby, ev.user, ev.change);
        else if (ev.type === 'join') cb(ev.lobby, ev.friend);
        else if (ev.type === 'microtxn') cb(ev.order, ev.authorized);
      } catch (err) {
        console.error(err);
      }
    }
  });
  const listen = (kind) => (cb) => {
    listeners[kind].add(cb);
    return () => listeners[kind].delete(cb);
  };
  const methods = [
    'me', 'createLobby', 'joinLobby', 'listLobbies', 'leaveLobby', 'setLobbyData', 'lobbyData', 'lobbyMembers', 'lobbyOwner',
    'setJoinable', 'inviteFriends', 'sendP2P', 'unlock', 'achievements', 'statGet', 'statSet', 'statsStore', 'cloudRead',
    'cloudWrite', 'presence', 'overlay', 'webApiTicket',
    'invAll', 'invDrop', 'invExchange', 'invConsume', 'invBuy', 'invDefs', 'invSetProps',
    'submitScore', 'scores', 'friends', 'showUser', 'timelineEvent', 'timelineState', 'timelineMode',
  ];
  const bridge = { appId: status.appId, onP2P: listen('p2p'), onLobbyChange: listen('lobby'), onJoinRequested: listen('join'), onMicroTxn: listen('microtxn') };
  for (const m of methods) bridge[m] = (...args) => call(m, ...args);
  contextBridge.exposeInMainWorld('steam', bridge);
} else {
  console.warn('Steam unavailable:', status.error);
}
