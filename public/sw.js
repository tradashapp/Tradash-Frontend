// Minimal service worker for PWA installability + basic offline shell.
//
// IMPORTANT: it must NEVER cache JS/CSS bundles or dev/HMR assets cache-first —
// doing so serves stale app code even after a rebuild (a classic PWA gotcha).
// So we only cache the navigation shell + a tight allowlist of static media
// (icons/manifest), and always go network-first for everything else.

const CACHE = "tradash-v2";
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
      .then(() => self.clients.claim())
  );
});

// Only these static, rarely-changing assets are safe to cache-first.
const CACHEABLE = /\.(png|svg|ico|webmanifest|woff2?)$/i;

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin
  // Never cache Next internals (JS/CSS bundles, HMR, RSC) — always live.
  if (url.pathname.startsWith("/_next/")) return;

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

  // Only whitelisted static media is cache-first; everything else is network.
  if (CACHEABLE.test(url.pathname)) {
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
  }
});
