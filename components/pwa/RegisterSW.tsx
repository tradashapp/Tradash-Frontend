"use client";

import { useEffect } from "react";

// Registers the service worker (production only — avoids caching headaches in
// dev). Renders nothing.
export function RegisterSW() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      typeof navigator === "undefined" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
