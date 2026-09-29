"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/hooks";
import { initSound } from "@/lib/sound";
import { initHaptics } from "@/lib/haptics";

// Initializes the sound + haptics engines against live settings. Call once near
// the app root. initSound also installs the gesture listeners that unlock (and,
// on iOS, keep re-unlocking) audio.
export function useFeedback() {
  const store = useAppStore();

  useEffect(() => {
    initSound(() => store.getState().settings.soundEnabled);
    initHaptics(() => store.getState().settings.hapticsEnabled);
  }, [store]);
}
