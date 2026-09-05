// Sound engine. Web Audio, not <audio> elements — the difference is latency.
//
// The old implementation cloned an HTMLAudioElement per play. A clone does NOT
// inherit the decoded audio of its source: it re-fetches the URL and re-decodes
// the MP3 on every single tap, which is why a click could sound a second late.
// HTMLAudioElement.play() is also promise-based and best-effort scheduled, so
// even a warm element drifts away from the gesture that triggered it.
//
// Here each clip is fetched and decoded exactly once into an AudioBuffer. A tap
// then allocates a throwaway AudioBufferSourceNode and calls start() — sample
// accurate, no I/O, no decode, no promise. That path is sub-millisecond, well
// inside the ~20 ms window where a sound still reads as "instant".

export type SoundName =
  | "tap"
  | "open"
  | "close"
  | "win"
  | "loss"
  | "profit";

const FILES: Record<SoundName, string> = {
  tap: "/audios/button_tap.mp3",
  open: "/audios/open_trade.mp3",
  close: "/audios/close_trade.mp3",
  win: "/audios/close_win.mp3",
  loss: "/audios/close_loss.mp3",
  profit: "/audios/profit_move.mp3",
};

// Taps fire on every button in the app, so they sit well under the trade
// events; profit repeats while PnL climbs, so it stays a garnish.
const VOLUME: Record<SoundName, number> = {
  tap: 0.3,
  open: 0.55,
  close: 0.55,
  win: 0.5,
  // Losing is already unpleasant — the cue acknowledges it, never punishes,
  // so it sits below the win.
  loss: 0.4,
  profit: 0.35,
};

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
let enabledGetter: () => boolean = () => true;

/** Preload + decode every clip and wire the enabled-check. Client only. */
export function initSound(isEnabled: () => boolean) {
  enabledGetter = isEnabled;
  if (typeof window === "undefined") return;

  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor || ctx) return;

  try {
    // "interactive" asks the platform for the smallest output buffer it can
    // give us, trading power for responsiveness — correct for UI feedback.
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    return; // No Web Audio (very old browser) — the app is silent, never broken.
  }

  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);

  // Decode ahead of time so the first tap is as fast as the thousandth.
  (Object.keys(FILES) as SoundName[]).forEach(async (name) => {
    try {
      const res = await fetch(FILES[name]);
      const raw = await res.arrayBuffer();
      buffers.set(name, await ctx!.decodeAudioData(raw));
    } catch {
      /* a missing clip must never break the interaction it accompanies */
    }
  });
}

// Browsers start an AudioContext suspended until a user gesture. Resuming is
// silent and idempotent, so unlike the old element-priming trick there is
// nothing here that can leak an audible smear on first touch.
export function unlockSound() {
  if (ctx?.state === "suspended") void ctx.resume();
}

export function playSound(name: SoundName) {
  if (!enabledGetter() || !ctx || !master) return;
  const buf = buffers.get(name);
  if (!buf) return;

  // A tap can be the very gesture that unlocks audio; resume inline so that
  // first tap is heard rather than swallowed.
  if (ctx.state === "suspended") void ctx.resume();

  try {
    // Source nodes are single-use and self-releasing: a fresh one per play is
    // the intended pattern, and it lets rapid taps overlap instead of cutting.
    const src = ctx.createBufferSource();
    src.buffer = buf;

    const gain = ctx.createGain();
    gain.gain.value = VOLUME[name];
    src.connect(gain).connect(master);

    // start(when=0) means "now" — scheduled on the audio clock, not the task
    // queue, so it lands on the click instead of after the next frame.
    // No start offset: decodeAudioData already strips MP3 encoder-delay padding,
    // so sample 0 IS the transient. Skipping ahead here would cut the attack
    // (and, for the 45 ms tap, very nearly the whole clip).
    src.start(0);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
  } catch {
    /* never let feedback throw into a trade path */
  }
}

/**
 * Close cue chosen by outcome: rising major for a win, falling minor for a
 * loss. Same interval logic as open/close (contour carries the meaning), so a
 * user learns the result before reading the toast. Exactly-zero PnL counts as
 * a win — it is a break-even exit, not a loss.
 */
export function playCloseOutcome(pnl: number) {
  playSound(pnl >= 0 ? "win" : "loss");
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
