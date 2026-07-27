"use client";

import { useEffect } from "react";

// Manages the service worker.
//  - PRODUCTION: register /sw.js for installability + offline shell.
//  - DEVELOPMENT: actively UNREGISTER any existing SW and clear its caches.
//    A leftover SW from a prod-build test otherwise serves stale bundles in dev
//    (changes don't show up) — this guarantees dev is always live code.
export function RegisterSW() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
      return;
    }

    // Dev: tear down any registered SW + caches so nothing is served stale.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
    if (typeof caches !== "undefined") {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
    }
  }, []);
  return null;
}
