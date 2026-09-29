"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { MusicNote01Icon } from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { MUSIC_TRACKS } from "@/lib/music";
import { playSound, unlockSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

// How long the track chip stays out after music starts or the track changes.
const CHIP_MS = 4000;

interface Props {
  /** Which side the track chip opens toward. */
  chipSide?: "left" | "right";
}

// Music on/off for the trade screen. Tap toggles. While playing, the icon is a
// little equalizer, and for a few seconds after turning on a chip names the
// track — tapping the chip skips to the next one. The chip then tucks away so
// it isn't permanent clutter over the chart; the full picker is in Settings.
export function MusicToggle({ chipSide = "right" }: Props) {
  const dispatch = useAppDispatch();
  const on = useAppSelector((s) => s.settings.musicEnabled);
  const trackId = useAppSelector((s) => s.settings.musicTrack);
  const track = MUSIC_TRACKS.find((t) => t.id === trackId) ?? MUSIC_TRACKS[0]!;
  const [chip, setChip] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showChip = () => {
    setChip(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setChip(false), CHIP_MS);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (!on) setChip(false);
  }, [on]);

  const toggle = () => {
    playSound("tap");
    haptic("tap");
    // This tap may be the first gesture on the page; resume the context in it
    // so the track starts now rather than on the NEXT tap.
    unlockSound();
    dispatch(updateSettings({ musicEnabled: !on }));
    if (!on) showChip();
  };

  const next = () => {
    playSound("tap");
    haptic("tap");
    const i = MUSIC_TRACKS.findIndex((t) => t.id === track.id);
    const n = MUSIC_TRACKS[(i + 1) % MUSIC_TRACKS.length]!;
    dispatch(updateSettings({ musicTrack: n.id }));
    showChip();
  };

  const chipEl = (
    <AnimatePresence>
      {on && chip && (
        <motion.button
          type="button"
          onClick={next}
          initial={{ opacity: 0, x: chipSide === "right" ? -8 : 8, scale: 0.9 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: chipSide === "right" ? -8 : 8, scale: 0.9 }}
          transition={{ duration: 0.16 }}
          aria-label={`Now playing ${track.label}. Tap for next track`}
          className="glass-inset flex h-9 items-center gap-1 whitespace-nowrap rounded-full px-3 text-xs font-semibold text-white/90 backdrop-blur-sm active:scale-95"
        >
          <span className="text-up">♪</span>
          {track.label}
          <span className="text-text-muted">›</span>
        </motion.button>
      )}
    </AnimatePresence>
  );

  return (
    <div className="flex items-center gap-2">
      {chipSide === "left" && chipEl}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={on}
        aria-label={on ? "Turn music off" : "Turn music on"}
        className={`glass-inset flex h-9 w-9 shrink-0 items-center justify-center rounded-full backdrop-blur-sm transition-[color,transform] duration-150 active:scale-95 ${
          on ? "text-up" : "text-white/45"
        }`}
      >
        {on ? <Equalizer /> : <HugeiconsIcon icon={MusicNote01Icon} size={18} />}
      </button>
      {chipSide === "right" && chipEl}
    </div>
  );
}

// Three bouncing bars — reads as "playing" at a glance, and doubles as the
// off-switch affordance. Static under reduced motion (see .eq-bar in globals).
function Equalizer() {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="eq-bar w-[3px] rounded-full bg-current"
          style={{ animationDelay: `${i * -0.28}s` }}
        />
      ))}
    </span>
  );
}
