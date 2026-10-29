// Ringer 3D for Steam: the web build in an Electron window. Steam itself lives in api.cjs (no
// window needed); this file only serves it to the game over IPC: the bridge in preload.cjs
// (window.steam, typed in src/steam.ts) lands every call in `api`.
const { app, BrowserWindow, ipcMain, protocol, net } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSteamApi, steamworks } = require('./api.cjs');

// The App ID: STEAM_APP_ID, else the one Steam passes when it launches the game (SteamAppId),
// else steam_appid.txt next to this file (480 = Valve's test app, for development).
const APP_ID = Number(process.env.STEAM_APP_ID || process.env.SteamAppId || readText(path.join(__dirname, 'steam_appid.txt')) || 480);
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

let win = null;
const steam = createSteamApi(APP_ID, (ev) => win && !win.isDestroyed() && win.webContents.send('steam:event', ev));

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

ipcMain.on('steam:status', (e) => {
  e.returnValue = { ok: steam.ok, appId: APP_ID, error: steam.error };
});
ipcMain.handle('steam', async (_e, method, args) => {
  if (!steam.ok) throw new Error('Steam is not running');
  const fn = steam.api[method];
  if (!fn) throw new Error(`no Steam call "${method}"`);
  return fn(...(args ?? []));
});

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

app.on('window-all-closed', () => {
  steam.stop();
  app.quit();
});

// The Steam overlay (Shift+Tab) draws into the window.
if (steam.ok) steamworks.electronEnableSteamOverlay();
