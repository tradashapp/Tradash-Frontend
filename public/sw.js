// Minimal service worker for PWA installability + basic offline shell.
//
// IMPORTANT: it must NEVER cache JS/CSS bundles or dev/HMR assets cache-first —
// doing so serves stale app code even after a rebuild (a classic PWA gotcha).
// So we only cache the navigation shell + a tight allowlist of static media
// (icons/manifest), and always go network-first for everything else.

// Bump on every icon/shell asset change — installed PWAs cache icons
// cache-first, so a stale CACHE name keeps serving the previous brand mark.
const CACHE = "tradash-v3";
const SHELL = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  // Do NOT auto-skipWaiting — wait for the user to tap "Refresh" in the update
  // toast, which posts SKIP_WAITING below. (Avoids reloading mid-action.)
});

// The page's "Refresh" button asks the waiting worker to take over.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
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

// --- Push notifications ---------------------------------------------------------
// The backend sends {id, title, body, url, category} (services/notifications).
// `tag` = the notification id, so a retried delivery replaces instead of stacking.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "Tradash", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.id || undefined,
      data: { url: typeof d.url === "string" && d.url.startsWith("/") ? d.url : "/" },
    })
  );
});

// Tap → focus an open Tradash tab on the notification's page, or open one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          return c.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : w));
        }
      }
      return self.clients.openWindow(url);
    })
  );
});

