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
  if (ctx.state === "suspended") void ctx.resume();
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
  if (ctx.state === "suspended") void ctx.resume();
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
