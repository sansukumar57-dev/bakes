const CACHE = 'crumb-v6';
const SHELL = ['/', '/styles.css', '/app.js', '/shared/pricing.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  // Fetched with 'reload' for the same reason as the fetch handler: the
  // precache must hold today's shell, not whatever the HTTP cache still has.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        Promise.all(
          SHELL.map((url) =>
            fetch(new Request(url, { cache: 'reload' })).then((res) => c.put(url, res)),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (request, response) => {
  const copy = response.clone();
  caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Never answer the worker script from the cache. If the worker could
  // serve its own file, a new version could never install, and the app
  // would be stuck on whatever was cached first.
  if (url.pathname === '/sw.js') return;

  // Prices and availability must never come from a cache.
  if (url.pathname.startsWith('/api/')) return;

  // Photographs never change, so serve them straight from the cache.
  if (url.pathname.startsWith('/img/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            put(request, res);
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else: try the network, fall back to the cache when offline.
  //
  // `cache: 'reload'` matters. The worker's own fetch goes through the HTTP
  // cache, so a plain fetch() can be answered from a still-fresh entry and the
  // worker will happily cache and serve the old file. Reloading skips the HTTP
  // cache for the request while the response is still stored below, so a
  // deploy is visible on the next load and offline still works.
  event.respondWith(
    fetch(request, { cache: 'reload' })
      .then((res) => {
        put(request, res);
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/'))),
  );
});
