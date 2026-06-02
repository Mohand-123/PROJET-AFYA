/**
 * Afya — Service Worker (PWA).
 * Stratégie : network-first pour HTML/API (toujours frais), cache-first pour les assets statiques.
 */
const VERSION = 'afya-v1';
const ASSETS = [
  '/',
  '/style.css',
  '/app.js',
  '/icons/afya.svg',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isAsset = /\.(css|js|svg|png|jpg|jpeg|woff2?|ico)$/i.test(url.pathname);
  if (isAsset) {
    // Cache-first
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, clone));
        return res;
      }).catch(() => cached))
    );
  } else {
    // Network-first (HTML, API)
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && req.headers.get('accept')?.includes('text/html')) {
            const clone = res.clone();
            caches.open(VERSION).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    );
  }
});
