// Minimal service worker for PWA installability + basic offline shell.
// Network-first for navigations (so live data/app updates are fresh), falling
// back to the cached shell when offline. Static assets are cached on the fly.

const CACHE = "tradash-v1";
const SHELL = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never cache API / oracle / websocket-ish or cross-origin calls — always live.
  if (url.origin !== self.location.origin) return;

  // Navigations: network-first, fall back to cached shell offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error()))
    );
    return;
  }

  // Same-origin static assets: cache-first with background refresh.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
    )
  );
});
