// Service worker template: the build fills in the cache version and the precache list (see vite.config.ts).
const CACHE = 'panelpilot-__VERSION__';
const PRECACHE = __PRECACHE__;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('panelpilot-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Pages: prefer the network so updates show up; fall back to the cached app offline.
    event.respondWith(fetch(request).catch(() => caches.match('./', { ignoreVary: true })));
    return;
  }
  // Assets have content hashes in their names, so the cached copy is always correct.
  // ignoreVary: module scripts are requested with an Origin header the precache requests lacked.
  event.respondWith(caches.match(request, { ignoreVary: true }).then(cached => cached || fetch(request)));
});
