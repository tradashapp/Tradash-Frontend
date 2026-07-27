"use client";

import { useEffect } from "react";
import { useToast } from "@/components/toast/ToastProvider";

// Manages the service worker.
//  - PRODUCTION: register /sw.js. When a new version is waiting, show a sticky
//    toast with a "Refresh" button that activates it and reloads.
//  - DEVELOPMENT: actively UNREGISTER any existing SW and clear its caches so a
//    leftover prod SW can never serve stale bundles in dev.
export function RegisterSW() {
  const { toast } = useToast();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    if (process.env.NODE_ENV !== "production") {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      if (typeof caches !== "undefined") {
        caches
          .keys()
          .then((keys) => keys.forEach((k) => caches.delete(k)))
          .catch(() => {});
      }
      return;
    }

    let refreshing = false;
    // When the new SW takes control, reload once to get the fresh app.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    const promptUpdate = (worker: ServiceWorker) => {
      toast("New version available", {
        type: "info",
        id: "pwa-update",
        duration: 0, // sticky until the user acts
        description: "Refresh to get the latest Tradash.",
        action: {
          label: "Refresh",
          onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
        },
      });
    };

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // Already an update waiting (e.g. from a previous visit).
        if (reg.waiting) promptUpdate(reg.waiting);

        // A new worker started installing → prompt when it finishes.
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              promptUpdate(nw);
            }
          });
        });
      })
      .catch(() => {});
  }, [toast]);

  return null;
}
