"use client";

import { useSyncExternalStore } from "react";
import { isSplashDone, subscribeToSplash } from "@/lib/splash";

// Re-renders once when the boot splash finishes. Server-renders as `false` so
// markup matches the client's first paint (the splash is always up initially).
export function useSplashDone(): boolean {
  return useSyncExternalStore(
    subscribeToSplash,
    isSplashDone,
    () => false
  );
}
