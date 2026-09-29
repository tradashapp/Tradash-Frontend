"use client";

import { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { playMusic, stopMusic } from "@/lib/music";

// Keeps the trade screen's music in step with settings. Mount once, after
// useFeedback (which creates the AudioContext this plays through).
//
// Plays only while the tab is visible: music carrying on from a background tab
// is the fastest way to get a site muted for good. Unmounting (leaving the
// trade screen) stops it.
//
// A persisted "on" can't actually sound until the first gesture — browsers
// start the context suspended. The track is scheduled anyway, and useFeedback's
// pointerdown unlock resumes the context, so it starts on the first tap.
export function useMusic() {
  const enabled = useAppSelector((s) => s.settings.musicEnabled);
  const track = useAppSelector((s) => s.settings.musicTrack);
  const hydrated = useAppSelector((s) => s.settings.hydrated);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (hydrated && enabled && visible) void playMusic(track);
    else stopMusic();
  }, [hydrated, enabled, visible, track]);

  useEffect(() => stopMusic, []);
}
