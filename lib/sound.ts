// Lightweight sound engine. Preloads the trade SFX and plays them on demand,
// gated by the user's soundEnabled setting (read via the getter passed to init).
// Uses plain HTMLAudioElement clones so overlapping plays don't cut each other.

export type SoundName = "tap" | "open" | "close" | "profit";

const FILES: Record<SoundName, string> = {
  tap: "/audios/button_tap.mp3",
  open: "/audios/open_trade.mp3",
  close: "/audios/close_trade.mp3",
  profit: "/audios/profit_move.mp3",
};

const VOLUME: Record<SoundName, number> = {
  tap: 0.35,
  open: 0.6,
  close: 0.6,
  profit: 0.4,
};

const buffers = new Map<SoundName, HTMLAudioElement>();
let enabledGetter: () => boolean = () => true;
let unlocked = false;

/** Preload clips and wire the enabled-check. Safe to call on the client only. */
export function initSound(isEnabled: () => boolean) {
  enabledGetter = isEnabled;
  if (typeof Audio === "undefined") return;
  (Object.keys(FILES) as SoundName[]).forEach((name) => {
    if (!buffers.has(name)) {
      const a = new Audio(FILES[name]);
      a.preload = "auto";
      a.volume = VOLUME[name];
      buffers.set(name, a);
    }
  });
}

// Browsers block audio until a user gesture. Call once on first interaction.
export function unlockSound() {
  if (unlocked || typeof Audio === "undefined") return;
  unlocked = true;
  buffers.forEach((a) => {
    a.play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
      })
      .catch(() => {});
  });
}

export function playSound(name: SoundName) {
  if (!enabledGetter() || typeof Audio === "undefined") return;
  const base = buffers.get(name);
  if (!base) return;
  // Clone so rapid repeats overlap cleanly instead of restarting one element.
  const node = base.cloneNode() as HTMLAudioElement;
  node.volume = VOLUME[name];
  node.play().catch(() => {});
}
