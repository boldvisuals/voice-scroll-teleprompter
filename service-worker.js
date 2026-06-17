/* Service worker — app-shell cache for offline + instant reopen (Phase 3).
 * Script bodies are cached separately in IndexedDB by preload.js; this caches
 * the static shell. Bump CACHE when you change shell files. */
const CACHE = 'vst-shell-v5';
const SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './store.js',
  './matcher.js',
  './voice.js',
  './preload.js',
  './drive.js',
  './app.js',
  './manifest.webmanifest',
  './scripts.json',
  './scripts/sizzle-intro.txt',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // Don't let one missing optional file abort the whole install.
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Never cache cross-origin (Drive/GIS) or the live manifest.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('scripts.json')) {
    // network-first so script changes show up, cache as fallback
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // cache-first for the shell
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
