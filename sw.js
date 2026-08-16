// This still exists mainly to force old caches to get cleaned up on
// activate — network-first below means you generally don't need to bump
// this just to see a new deploy anymore.
const CACHE_VERSION = 'v8';
const CACHE_NAME = `bc-scanner-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon-32.png',
  './favicon-16.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API/auth/websocket traffic — that data must always be
  // live. Only the static app shell (same-origin GET requests for the
  // files listed above) gets any special treatment at all.
  const isSameOrigin = url.origin === self.location.origin;
  const isShellRequest = event.request.method === 'GET' && isSameOrigin;

  if (!isShellRequest) return; // let it hit the network normally

  // Network-first, cache as a fallback for offline only. This app needs
  // live network access to be useful at all, so there's no real benefit
  // to preferring a stale cached copy over a fresh one when online — and
  // it means every deploy shows up on next load without needing to bump
  // CACHE_VERSION or manually clear site data.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
