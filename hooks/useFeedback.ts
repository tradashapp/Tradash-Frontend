"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/hooks";
import { initSound, unlockSound } from "@/lib/sound";
import { initHaptics } from "@/lib/haptics";

// Initializes the sound + haptics engines against live settings, and unlocks
// audio on the first user gesture (browsers block autoplay otherwise). Call once
// near the app root.
export function useFeedback() {
  const store = useAppStore();

  useEffect(() => {
    initSound(() => store.getState().settings.soundEnabled);
    initHaptics(() => store.getState().settings.hapticsEnabled);

    // Not { once: true }: an AudioContext can be re-suspended by the browser
    // (tab backgrounded, iOS reclaiming audio), and a one-shot listener would
    // already be gone. unlockSound() is a no-op unless actually suspended, so
    // leaving it attached costs nothing and keeps audio recoverable.
    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock);
    document.addEventListener("visibilitychange", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      document.removeEventListener("visibilitychange", unlock);
    };
  }, [store]);
}
