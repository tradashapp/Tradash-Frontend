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
//
// The unlock MUST be silent. play() resolves asynchronously, so pausing in the
// .then() still lets each clip sound for a few ms first — with four buffers
// that's an audible smear layered under the tap that triggered the unlock.
// Muting for the round-trip makes the unlock inaudible; we restore the real
// volume afterwards so the next playSound() is unaffected.
export function unlockSound() {
  if (unlocked || typeof Audio === "undefined") return;
  unlocked = true;
  buffers.forEach((a, name) => {
    a.muted = true;
    a.volume = 0;
    a.play()
      .then(() => {
        a.pause();
        a.currentTime = 0;
      })
      .catch(() => {})
      .finally(() => {
        a.muted = false;
        a.volume = VOLUME[name];
      });
  });
}

export function playSound(name: SoundName) {
  if (!enabledGetter() || typeof Audio === "undefined") return;
  const base = buffers.get(name);
  if (!base) return;
  // Clone so rapid repeats overlap cleanly instead of restarting one element.
  // Reset muted/volume explicitly: a clone taken mid-unlock would otherwise
  // inherit the muted state the unlock sets on the base element.
  const node = base.cloneNode() as HTMLAudioElement;
  node.muted = false;
  node.volume = VOLUME[name];
  node.play().catch(() => {});
}

// --- Profit-move ticker ------------------------------------------------------
// Plays "profit" on each significant step UP in PnL (never on loss moves).
// Tracks the last milestone per position; reset when a position opens/closes.
let profitAnchor: number | null = null;
let profitStep = 1;

/** Begin tracking profit moves for a new position (step = $ per profit tick). */
export function beginProfitTracking(step: number) {
  profitAnchor = 0;
  profitStep = Math.max(step, 0.01);
}

export function stopProfitTracking() {
  profitAnchor = null;
}

/** Feed the current PnL; plays "profit" when it climbs past the next step. */
export function tickProfit(pnl: number) {
  if (profitAnchor == null) return;
  // Only react while in profit and moving further into profit.
  if (pnl <= profitAnchor) {
    // Ratchet the anchor down with losses so re-crossing up re-triggers, but
    // never below zero (we only celebrate profit-direction moves).
    if (pnl < profitAnchor) profitAnchor = Math.max(0, pnl);
    return;
  }
  if (pnl - profitAnchor >= profitStep) {
    profitAnchor = pnl;
    playSound("profit");
  }
}
