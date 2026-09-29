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
// Called after the context is replaced, so lib/music can rebuild its nodes on
// the new one. AudioBuffers are not tied to a context, so decoded clips carry
// over untouched.
const resetListeners = new Set<() => void>();
let lastRebuild = 0;
// Set once any context has actually played. A context that never started just
// hasn't had a real gesture yet (a scroll's touchend doesn't count); only one
// that ran and then won't come back is wedged and worth replacing.
let everRan = false;

// --- iOS -----------------------------------------------------------------------
// Three separate WebKit behaviours made audio on iPhone work "the first time,
// then randomly or never" while Android was fine:
//
// 1. Only touchend / click / keydown count as a gesture for starting audio. The
//    old unlock listened on pointerdown, which iOS ignores, so audio only woke
//    up when a tap happened to land on a button that resumed it in its onClick.
// 2. Backgrounding, locking the screen, a call or Siri move the context to
//    "interrupted", not "suspended". Every resume was gated on "suspended", so
//    after the first trip to the background nothing ever resumed it again.
// 3. Web Audio defaults to the "ambient" session category, which the ring/silent
//    switch mutes. Most iPhones live on silent, so it looked broken outright.
//
// Worse, an iOS PWA can come back from the background with a context whose
// resume() never completes. The only cure is a fresh context, so a gesture that
// fails to revive the old one within RESUME_TIMEOUT_MS replaces it.
const GESTURES = ["touchend", "click", "keydown", "pointerup", "mousedown"] as const;
const RESUME_TIMEOUT_MS = 400;
const REBUILD_COOLDOWN_MS = 1500;

function isRunning(c: AudioContext) {
  return c.state === "running";
}

function audioCtor(): typeof AudioContext | undefined {
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

function createContext(): boolean {
  const Ctor = audioCtor();
  if (!Ctor) return false;
  try {
    // "interactive" asks the platform for the smallest output buffer it can
    // give us, trading power for responsiveness — correct for UI feedback.
    ctx = new Ctor({ latencyHint: "interactive" });
  } catch {
    return false; // No Web Audio (very old browser) — the app is silent, never broken.
  }
  const c = ctx;
  c.onstatechange = () => {
    if (isRunning(c)) everRan = true;
  };
  if (isRunning(c)) everRan = true;
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  return true;
}

// Play one silent frame inside the gesture. Resume alone is enough on current
// iOS, but older WebKit only unlocks a context that starts a source while the
// gesture is still on the stack.
function primeInGesture(c: AudioContext) {
  try {
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, c.sampleRate);
    src.connect(c.destination);
    src.start(0);
    src.onended = () => src.disconnect();
  } catch {
    /* best-effort */
  }
}

function rebuildContext() {
  const old = ctx;
  if (!createContext()) return;
  lastRebuild = Date.now();
  if (old && old.state !== "closed") void old.close().catch(() => {});
  if (ctx && !isRunning(ctx)) void ctx.resume().catch(() => {});
  resetListeners.forEach((fn) => fn());
}

function onGesture() {
  if (!ctx) return;
  const c = ctx;
  if (c.state === "closed") {
    rebuildContext();
    if (ctx) primeInGesture(ctx);
    return;
  }
  if (isRunning(c)) return;
  primeInGesture(c);
  void c.resume().catch(() => {});
  setTimeout(() => {
    if (
      ctx === c &&
      everRan &&
      !isRunning(c) &&
      document.visibilityState === "visible" &&
      Date.now() - lastRebuild > REBUILD_COOLDOWN_MS
    ) {
      rebuildContext();
    }
  }, RESUME_TIMEOUT_MS);
}

/** Preload + decode every clip and wire the enabled-check. Client only. */
export function initSound(isEnabled: () => boolean) {
  enabledGetter = isEnabled;
  if (typeof window === "undefined" || ctx) return;

  // iOS 16.4+: the "playback" category plays through the silent switch, the
  // same as a video or a music app. It must be set before audio starts.
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (session) {
    try {
      session.type = "playback";
    } catch {
      /* unsupported value — keep the default */
    }
  }

  if (!createContext()) return;

  // Capture phase on window: runs before React's handlers, so a button's own
  // sound plays on a context that is already resuming. Left attached for the
  // page's life (never { once }) because iOS re-interrupts the context every
  // time the app is backgrounded.
  for (const type of GESTURES) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }
  // Not a gesture, so iOS may refuse, but desktop browsers resume here.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeAudio();
  });

  // Decode ahead of time so the first tap is as fast as the thousandth.
  (Object.keys(FILES) as SoundName[]).forEach(async (name) => {
    try {
      const res = await fetch(FILES[name]);
      const buf = await decodeClip(await res.arrayBuffer());
      if (buf) buffers.set(name, buf);
    } catch {
      /* a missing clip must never break the interaction it accompanies */
    }
  });
}

/**
 * Decode on whichever context is current. If that context was replaced (and
 * closed) mid-decode, WebKit rejects, so retry once on the new one. The copy is
 * needed because a decode attempt detaches its ArrayBuffer.
 */
export async function decodeClip(raw: ArrayBuffer): Promise<AudioBuffer | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const c = ctx;
    if (!c) return null;
    try {
      return await c.decodeAudioData(raw.slice(0));
    } catch {
      if (ctx === c) return null; // a genuinely bad clip, not a swapped context
    }
  }
  return null;
}

/** Resume a suspended OR interrupted context. Idempotent and silent. */
export function resumeAudio() {
  if (ctx && ctx.state !== "running" && ctx.state !== "closed") {
    void ctx.resume().catch(() => {});
  }
}

// Kept for the buttons that resume in their own onClick. The window-level
// gesture listeners do the real work now; this also covers a gesture that
// stopped propagation before reaching them.
export function unlockSound() {
  onGesture();
}

/** Subscribe to context replacement. Returns an unsubscribe. */
export function onAudioReset(fn: () => void): () => void {
  resetListeners.add(fn);
  return () => resetListeners.delete(fn);
}

export function playSound(name: SoundName) {
  if (!enabledGetter() || !ctx || !master) return;
  const buf = buffers.get(name);
  if (!buf) return;

  // A tap can be the very gesture that unlocks audio; resume inline so that
  // first tap is heard rather than swallowed.
  resumeAudio();

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

// --- Momentum cues -----------------------------------------------------------
// Driven by useMomentumFeedback from lib/momentum's events.

// Major-pentatonic ladder, in semitones. Every rung is consonant with every
// other, so however far a combo climbs the chimes never clash — each favorable
// step plays the profit clip one rung higher, like coins in a platformer.
const COMBO_LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

/** One favorable move. `count` = consecutive favorable steps so far (1-based). */
export function playComboStep(count: number) {
  const rung = COMBO_LADDER[Math.min(count - 1, COMBO_LADDER.length - 1)] ?? 0;
  playBuffer("profit", 2 ** (rung / 12));
}

/** A soft falling blip for an adverse move — acknowledges, never nags. */
export function playAdverseStep() {
  tone([{ type: "sine", from: 262, to: 196, at: 0, dur: 0.11, gain: 0.07 }]);
}

/** The market ripping in your direction: a fast rising arpeggio. */
export function playSurge(mega: boolean) {
  const notes = mega ? [523, 659, 784, 1047, 1319] : [523, 659, 784, 1047];
  tone(
    notes.map((f, i) => ({
      type: "triangle" as const,
      from: f,
      to: f,
      at: i * 0.045,
      dur: 0.12,
      gain: mega ? 0.16 : 0.13,
    }))
  );
}

/** The market ripping against you: one low falling sweep. */
export function playSlump() {
  tone([{ type: "sine", from: 330, to: 130, at: 0, dur: 0.28, gain: 0.14 }]);
}

/** The shared context + output, for lib/music. Null until initSound runs. */
export function audioOutput(): { ctx: AudioContext; out: AudioNode } | null {
  return ctx && master ? { ctx, out: master } : null;
}

// playSound with a pitch/speed multiplier. Kept separate so the plain path
// above stays exactly as tuned.
function playBuffer(name: SoundName, rate: number) {
  if (!enabledGetter() || !ctx || !master) return;
  const buf = buffers.get(name);
  if (!buf) return;
  resumeAudio();
  try {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = VOLUME[name];
    src.connect(gain).connect(master);
    src.start(0);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
  } catch {
    /* never let feedback throw into a trade path */
  }
}

interface Note {
  type: OscillatorType;
  from: number; // Hz at the start
  to: number; // Hz at the end (exponential glide)
  at: number; // s offset from now
  dur: number; // s
  gain: number;
}

// Tiny oscillator voice for cues that don't warrant a sample file. Each note
// gets a 5ms attack and an exponential decay, which is what keeps a raw
// oscillator from clicking on and off.
function tone(notes: Note[]) {
  if (!enabledGetter() || !ctx || !master) return;
  resumeAudio();
  try {
    const now = ctx.currentTime;
    for (const n of notes) {
      const t0 = now + n.at;
      const osc = ctx.createOscillator();
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.from, t0);
      if (n.to !== n.from) osc.frequency.exponentialRampToValueAtTime(n.to, t0 + n.dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(n.gain, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + n.dur + 0.02);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
    }
  } catch {
    /* best-effort */
  }
}
