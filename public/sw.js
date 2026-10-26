// Offline support without ever pinning an old build.
//  - The page itself (navigations, index.html): network first, the cached copy only offline.
//    A cache-first page kept returning visitors on a build whose scripts no longer exist.
//  - Built assets (/assets/, hashed names): cache first; they never change once published.
//  - Nothing is cached unless its type matches what was asked for: the host answers a missing
//    file with the app page (SPA fallback), and caching that as a script made a white page.
const CACHE = 'ringer3d-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const stale = keys.filter((k) => k !== CACHE);
      await Promise.all(stale.map((k) => caches.delete(k)));
      await self.clients.claim();
      // Tabs opened under an older worker may be showing a dead build: reload them onto this one.
      if (stale.length) {
        const tabs = await self.clients.matchAll({ type: 'window' });
        for (const t of tabs) t.navigate(t.url).catch(() => {});
      }
    })(),
  );
});

/** Does the response actually hold what the URL asks for? */
function fits(url, res) {
  const type = res.headers.get('content-type') || '';
  const ext = url.pathname.split('.').pop().toLowerCase();
  if (ext === 'js' || ext === 'mjs') return type.includes('javascript');
  if (ext === 'css') return type.includes('css');
  if (ext === 'wasm') return type.includes('wasm');
  if (ext === 'html') return type.includes('html');
  return !type.includes('text/html');
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // The page: always try the network first.
  if (e.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
    );
    return;
  }

  // Built assets: cache first, and only cache what really is the asset.
  if (url.pathname.includes('/assets/')) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok && fits(url, res)) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          }),
      ),
    );
  }
});
