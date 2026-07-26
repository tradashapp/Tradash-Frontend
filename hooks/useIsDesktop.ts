"use client";

import { useSyncExternalStore } from "react";

// True on lg+ screens (≥1024px). SSR-safe via useSyncExternalStore.
const QUERY = "(min-width: 1024px)";

function subscribe(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

export function useIsDesktop() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false // server: assume mobile-first
  );
}
