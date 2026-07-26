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

    const unlock = () => unlockSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [store]);
}
