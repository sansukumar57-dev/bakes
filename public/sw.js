const CACHE = 'crumb-v3';
const SHELL = ['/', '/styles.css', '/app.js', '/shared/pricing.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  event.respondWith(
    fetch(request)
      .then((res) => {
        put(request, res);
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/'))),
  );
});
