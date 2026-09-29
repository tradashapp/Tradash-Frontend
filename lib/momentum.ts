// Momentum engine: turns the active market's price stream + the open position
// into game-feel events — per-move combo steps, surges (the market ripping in
// or against your direction), and short emoji callouts ("🎯 Perfect").
//
// Pure and clock-free (time comes in on each sample, randomness is injected),
// so it can be driven from a hook in the app and from a script in tests alike.
// It decides WHAT happened; useMomentumFeedback decides how it sounds and feels.
//
// Everything is measured against the market's OWN recent volatility rather than
// in dollars or ROI. A $ step would chime constantly on a 40× BTC position and
// never on a 2× one; a volatility-relative step makes "a move" mean the same
// thing on every market at every size, and makes "pumping hard" mean unusual
// for THIS market right now, not just big.

import type { Direction } from "@/types";

export type CalloutTone = "good" | "great" | "epic" | "bad" | "warn";

export interface Callout {
  emoji: string;
  text: string;
  tone: CalloutTone;
}

export type MomentumEvent =
  /** Price moved one step. `count` = consecutive steps the same way. */
  | { kind: "step"; favorable: boolean; count: number }
  /** An unusually fast move for this market. `mega` = the extreme tier. */
  | { kind: "surge"; favorable: boolean; mega: boolean }
  | { kind: "callout"; callout: Callout };

export interface MomentumPosition {
  /** Changes when a different position opens, resetting per-position state. */
  key: string;
  direction: Direction;
  pnl: number;
  margin: number;
  entryPrice: number;
  /** In the same price space as `price`. Omit when unknown. */
  liquidationPrice?: number;
}

export interface MomentumSample {
  t: number; // ms
  symbol: string;
  price: number;
  position: MomentumPosition | null;
}

// --- Tuning ------------------------------------------------------------------

// EWMA weight for the typical per-sample |Δprice|. Samples land every ~200ms,
// so 0.03 remembers roughly the last 6-7 seconds.
const BASELINE_ALPHA = 0.03;
// Samples before the baseline is trusted enough to call a surge.
const WARMUP_SAMPLES = 12;
// One "move" = this many typical ticks of travel from the last step.
const STEP_TICKS = 2.5;
// Step clamps as a fraction of price: never so small a frozen feed chimes on
// dust, never so large a volatile market goes silent.
const STEP_MIN_FRAC = 0.00005; // 0.5 bps
const STEP_MAX_FRAC = 0.0008; // 8 bps
// Surge window and thresholds. z = move ÷ what a random walk would do in that
// many ticks; the absolute floor keeps a dead-calm market from "surging" on
// a tick that is only big relative to nothing.
const SURGE_WINDOW_MS = 1500;
const SURGE_Z = 3;
const SURGE_MIN_FRAC = 0.00025; // 2.5 bps
const MEGA_Z = 4.5;
const MEGA_MIN_FRAC = 0.0006; // 6 bps
const SURGE_COOLDOWN_MS = 3000;
// Callout pacing. A higher tier may cut a lower one's cooldown short.
const CALLOUT_GAP_MS = 2200;
const CALLOUT_URGENT_GAP_MS = 900;
// No callouts right after opening: the first ticks are fill noise.
const SETTLE_MS = 1200;
// ROI milestones, each announced once per position.
const MILESTONES: [number, Callout][] = [
  [0.1, { emoji: "💰", text: "+10%", tone: "good" }],
  [0.25, { emoji: "🤑", text: "+25%!", tone: "great" }],
  [0.5, { emoji: "🏆", text: "+50%!", tone: "epic" }],
  [1, { emoji: "💯", text: "Doubled!", tone: "epic" }],
  [2, { emoji: "🐐", text: "Tripled!", tone: "epic" }],
];
// Losing this much ROI arms the "back in green" callout.
const COMEBACK_ARM_ROI = -0.03;
// Fraction of the entry→liquidation distance left that counts as "near".
// Re-arms only once price has backed off past the second threshold.
const NEAR_LIQ = 0.25;
const NEAR_LIQ_CLEAR = 0.4;

const PHRASES = {
  combo3: [
    ["👍", "Nice"],
    ["😎", "Smooth"],
    ["✨", "Sweet"],
    ["👌", "Clean"],
  ],
  combo6: [
    ["🎯", "Perfect"],
    ["💪", "Strong"],
    ["🙌", "Beautiful"],
    ["😤", "Let's go"],
  ],
  comboEpic: [
    ["🔥", "On fire!"],
    ["⚡", "Unstoppable"],
    ["🤑", "Printing!"],
    ["👑", "Masterclass"],
  ],
  surge: [
    ["🚀", "Incredible!"],
    ["🚀", "Sending it!"],
    ["💥", "Massive move!"],
    ["🤯", "Unreal!"],
  ],
  mega: [
    ["🌕", "To the moon!"],
    ["🚀", "INSANE!"],
  ],
  newHigh: [
    ["💎", "New high"],
    ["📈", "New peak"],
  ],
  comeback: [
    ["😮‍💨", "Back in green"],
    ["🙏", "Phew"],
  ],
  adverse: [
    ["😬", "Uhh…"],
    ["😕", "Uhnnn"],
    ["🫤", "Hmm"],
    ["🙃", "Not like this"],
  ],
  slump: [
    ["🥲", "Ouch"],
    ["😵", "Yikes"],
    ["📉", "Rough"],
  ],
} as const satisfies Record<string, readonly (readonly [string, string])[]>;

type PhraseSet = keyof typeof PHRASES;

const TONE_RANK: Record<CalloutTone, number> = {
  good: 0,
  bad: 0,
  great: 1,
  epic: 2,
  warn: 2,
};

interface PositionState {
  key: string;
  startedAt: number;
  anchor: number; // price at the last step
  combo: number; // consecutive favorable steps
  adverse: number; // consecutive adverse steps
  peakPnl: number;
  drewDown: boolean; // fell meaningfully off the peak since it was set
  milestones: number; // count of MILESTONES already announced
  comebackArmed: boolean;
  nearLiq: boolean;
}

export class MomentumTracker {
  private symbol: string | null = null;
  private lastPrice: number | null = null;
  private baseline = 0; // EWMA of |Δprice| per sample
  private samples = 0;
  private window: { t: number; p: number }[] = [];
  private lastSurgeAt = -Infinity;
  private lastCalloutAt = -Infinity;
  private lastCalloutText = "";
  private pos: PositionState | null = null;

  constructor(private rng: () => number = Math.random) {}

  feed(s: MomentumSample): MomentumEvent[] {
    if (!(s.price > 0)) return [];
    if (s.symbol !== this.symbol) this.resetMarket(s.symbol);
    this.observe(s.t, s.price);

    const p = s.position;
    if (!p) {
      this.pos = null;
      return [];
    }
    if (this.pos?.key !== p.key) this.pos = this.freshPosition(p, s);

    const out: MomentumEvent[] = [];
    const callouts: Callout[] = [];
    const pos = this.pos;
    const dir = p.direction === "long" ? 1 : -1;
    const settled = s.t - pos.startedAt >= SETTLE_MS;

    // --- Steps ---------------------------------------------------------------
    const step = Math.min(
      Math.max(this.baseline * STEP_TICKS, s.price * STEP_MIN_FRAC),
      s.price * STEP_MAX_FRAC
    );
    const travelled = (s.price - pos.anchor) * dir;
    if (Math.abs(travelled) >= step) {
      pos.anchor = s.price;
      if (travelled > 0) {
        pos.combo++;
        pos.adverse = 0;
        out.push({ kind: "step", favorable: true, count: pos.combo });
        const c = pos.combo;
        // Praise needs a trade that is actually winning — "Nice" on a streak
        // that only claws back part of a loss rings hollow.
        if (p.pnl > 0) {
          if (c === 3) callouts.push(this.pick("combo3", "good"));
          else if (c === 6) callouts.push(this.pick("combo6", "great"));
          else if (c >= 10 && c % 5 === 0) callouts.push(this.pick("comboEpic", "epic"));
        }
      } else {
        pos.adverse++;
        pos.combo = 0;
        out.push({ kind: "step", favorable: false, count: pos.adverse });
        if (pos.adverse === 3) callouts.push(this.pick("adverse", "bad"));
      }
    }

    // --- Surge ---------------------------------------------------------------
    if (this.samples >= WARMUP_SAMPLES && s.t - this.lastSurgeAt >= SURGE_COOLDOWN_MS) {
      const surge = this.detectSurge(s.t, s.price);
      if (surge) {
        this.lastSurgeAt = s.t;
        const favorable = surge.dir === dir;
        out.push({ kind: "surge", favorable, mega: surge.mega });
        callouts.push(
          favorable
            ? surge.mega
              ? this.pick("mega", "epic")
              : this.pick("surge", "epic")
            : this.pick("slump", "bad")
        );
      }
    }

    // --- PnL-shaped moments --------------------------------------------------
    const roi = p.margin > 0 ? p.pnl / p.margin : 0;

    while (pos.milestones < MILESTONES.length && roi >= MILESTONES[pos.milestones]![0]) {
      callouts.push(MILESTONES[pos.milestones]![1]);
      pos.milestones++;
    }

    if (p.pnl > pos.peakPnl) {
      if (pos.drewDown && pos.peakPnl > 0 && roi > 0.03) {
        callouts.push(this.pick("newHigh", "great"));
      }
      pos.peakPnl = p.pnl;
      pos.drewDown = false;
    } else if (pos.peakPnl > 0 && p.pnl <= pos.peakPnl * 0.7) {
      pos.drewDown = true;
    }

    if (roi <= COMEBACK_ARM_ROI) pos.comebackArmed = true;
    else if (pos.comebackArmed && p.pnl > 0) {
      pos.comebackArmed = false;
      callouts.push(this.pick("comeback", "great"));
    }

    const liq = p.liquidationPrice;
    if (liq != null && liq > 0 && Math.abs(p.entryPrice - liq) > 0) {
      // 1 at entry, 0 at liquidation; negative past it (already liquidated).
      const room = ((s.price - liq) * dir) / Math.abs(p.entryPrice - liq);
      if (!pos.nearLiq && room < NEAR_LIQ && room > 0) {
        pos.nearLiq = true;
        callouts.push({ emoji: "⚠️", text: "Near liquidation", tone: "warn" });
      } else if (pos.nearLiq && room > NEAR_LIQ_CLEAR) {
        pos.nearLiq = false;
      }
    }

    // --- One callout per sample, highest tier wins ----------------------------
    if (settled && callouts.length) {
      // Ties go to the LATER candidate: surges and PnL moments are pushed
      // after step streaks and are the bigger news at the same tier.
      const best = callouts.reduce((a, b) => (TONE_RANK[b.tone] >= TONE_RANK[a.tone] ? b : a));
      const gap = s.t - this.lastCalloutAt;
      const urgent = TONE_RANK[best.tone] >= 2;
      if (gap >= CALLOUT_GAP_MS || (urgent && gap >= CALLOUT_URGENT_GAP_MS)) {
        this.lastCalloutAt = s.t;
        this.lastCalloutText = best.text;
        out.push({ kind: "callout", callout: best });
      }
    }
    return out;
  }

  private resetMarket(symbol: string) {
    this.symbol = symbol;
    this.lastPrice = null;
    this.baseline = 0;
    this.samples = 0;
    this.window = [];
    this.pos = null;
  }

  private observe(t: number, price: number) {
    if (this.lastPrice != null) {
      const d = Math.abs(price - this.lastPrice);
      this.baseline =
        this.samples === 0 ? d : this.baseline + BASELINE_ALPHA * (d - this.baseline);
      this.samples++;
    }
    this.lastPrice = price;
    this.window.push({ t, p: price });
    while (this.window.length > 1 && t - this.window[0]!.t > SURGE_WINDOW_MS) {
      this.window.shift();
    }
  }

  private detectSurge(t: number, price: number): { dir: 1 | -1; mega: boolean } | null {
    const first = this.window[0];
    const ticks = this.window.length - 1;
    if (!first || ticks < 3 || t - first.t < SURGE_WINDOW_MS * 0.6) return null;
    const move = price - first.p;
    const frac = Math.abs(move) / price;
    const expected = this.baseline * Math.sqrt(ticks);
    if (!(expected > 0)) return null;
    const z = Math.abs(move) / expected;
    if (z < SURGE_Z || frac < SURGE_MIN_FRAC) return null;
    return { dir: move > 0 ? 1 : -1, mega: z >= MEGA_Z && frac >= MEGA_MIN_FRAC };
  }

  private freshPosition(p: MomentumPosition, s: MomentumSample): PositionState {
    return {
      key: p.key,
      startedAt: s.t,
      anchor: s.price,
      combo: 0,
      adverse: 0,
      peakPnl: Math.max(0, p.pnl),
      drewDown: false,
      // A position picked up mid-flight (reload, market switch) shouldn't
      // re-announce milestones it already passed.
      milestones: MILESTONES.filter(
        ([roi]) => p.margin > 0 && p.pnl / p.margin >= roi
      ).length,
      comebackArmed: false,
      nearLiq: false,
    };
  }

  /** A random phrase from the set, avoiding an immediate repeat. */
  private pick(set: PhraseSet, tone: CalloutTone): Callout {
    const options = PHRASES[set];
    let i = Math.floor(this.rng() * options.length) % options.length;
    if (options.length > 1 && options[i]![1] === this.lastCalloutText) {
      i = (i + 1) % options.length;
    }
    const [emoji, text] = options[i]!;
    return { emoji, text, tone };
  }
}
