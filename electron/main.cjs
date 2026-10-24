// Desktop shell (Windows / macOS / Linux). Serves the built game from an
// app:// scheme (ES modules do not load from file://), opens one window.
//   npm run build && npm run desktop
//   electron . --smoke   -> boot, wait for the game, print RINGER_SMOKE_OK, quit
const { app, BrowserWindow, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SMOKE = process.argv.includes('--smoke');
const DIST = path.join(__dirname, '..', 'dist');
// Windows GUI apps have no stdout, so the smoke verdict also goes to a file.
const SMOKE_OUT = process.argv.find((a) => a.startsWith('--smoke-out='))?.slice(12);
function report(line) {
  console.log(line);
  if (SMOKE_OUT) require('node:fs').appendFileSync(SMOKE_OUT, `${line}\n`);
}

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

if (SMOKE) app.commandLine.appendSwitch('use-angle', 'swiftshader');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0b0f1a',
    title: 'Ringer 3D',
    icon: path.join(DIST, 'icons', 'icon-512.png'),
    autoHideMenuBar: true,
    show: !SMOKE,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Links (e.g. a server's site) open in the real browser, never inside the game.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('app://game/index.html');
  if (SMOKE) {
    const deadline = setTimeout(() => {
      report('RINGER_SMOKE_FAIL timeout');
      app.exit(1);
    }, 90000);
    win.webContents.on('console-message', (_e, level, msg) => level >= 3 && report(`page error: ${msg}`));
    let done = false;
    const poll = setInterval(async () => {
      try {
        const ok = await win.webContents.executeJavaScript('!!(window.__ringer && window.__ringer.scene)');
        if (ok && !done) {
          done = true;
          clearInterval(poll);
          clearTimeout(deadline);
          report('RINGER_SMOKE_OK');
          app.exit(0);
        }
      } catch {
        /* page not ready */
      }
    }, 500);
  }
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
