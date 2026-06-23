/**
 * Afya — Service Worker (PWA).
 * Stratégie : network-only pour HTML (toujours frais — pas de cache de page),
 * cache-first pour les assets statiques.
 *
 * BUMP la VERSION à chaque changement structurel : ça force l'activation d'un
 * nouveau SW + delete les vieux caches pour tous les utilisateurs.
 */
const VERSION = 'afya-v3-2026-06-23';
const ASSETS = [
  '/style.css',
  '/app.js',
  '/icons/afya.svg',
  '/icons/afya-192.png',
  '/icons/afya-512.png',
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
    // Supprime TOUS les caches dont le nom diffère de VERSION
    // → vieux assets, vieilles pages, etc. sont évictés
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isAsset = /\.(css|js|svg|png|jpg|jpeg|woff2?|ico)$/i.test(url.pathname);
  const isHTML = req.headers.get('accept')?.includes('text/html');

  if (isAsset) {
    // Cache-first pour assets statiques (toujours versionnés par hash de contenu de toute façon)
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(VERSION).then((cache) => cache.put(req, clone));
        return res;
      }).catch(() => cached))
    );
  } else if (isHTML) {
    // NETWORK-ONLY pour les pages HTML — jamais de cache, toujours la version live
    // Fallback uniquement si offline complet → on essaie de servir / depuis le cache pour PWA
    event.respondWith(
      fetch(req).catch(() => caches.match('/') || new Response('Offline', { status: 503 }))
    );
  }
  // Autres requêtes (API, fetch dynamiques) : pass-through réseau, pas d'interception
});

// Kill-switch : si la page envoie postMessage('SKIP_WAITING'), on s'active immédiatement
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
