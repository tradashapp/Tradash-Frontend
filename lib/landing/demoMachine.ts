// State machine behind the landing-page phone demo.
//
// Three cases, per the brief:
//   1. IDLE — the user does nothing. After a beat the demo presses a button
//      ITSELF (visibly: the button shows a pressed state), rides the move, and
//      auto-closes in profit.
//   2. User taps UP — price trends up continuously, with small pullbacks, and
//      never goes into loss. Closes in profit.
//   3. User taps DOWN — mirror image; a short is profitable as price falls.
//
// The invariant across all three: PnL may dip toward zero on a pullback but is
// clamped so it never prints red, and the close always books a gain.

export type DemoPhase =
  | "flat" // no position; waiting for a tap or the idle timer
  | "autoPress" // idle path: showing the synthetic button press
  | "open" // in a position, riding the move
  | "closing"; // close fired; toast + sound, returning to flat

export type Direction = "long" | "short";

/** Notional size of a demo position, in USD. */
export const DEMO_SIZE = 500;
/** Leverage shown/used for the demo PnL math. */
export const DEMO_LEVERAGE = 20;
/** Margin the demo position consumes. */
export const DEMO_MARGIN = DEMO_SIZE / DEMO_LEVERAGE;

/** Seconds of inactivity before the demo trades on its own. */
export const IDLE_DELAY_MS = 4200;
/** How long the synthetic press is held before the position opens. */
export const AUTO_PRESS_MS = 520;
/** Minimum time a position stays open before it may auto-close. */
export const MIN_HOLD_MS = 5200;
/** Profit target ($) at which the demo takes the win. */
export const TARGET_PNL = 30;
/** Pause on the closed toast before the next cycle can start. */
export const COOLDOWN_MS = 2600;

// Per-tick drift applied in the position's favour. Tuned so a position reaches
// roughly TARGET_PNL over MIN_HOLD_MS at 60fps with DEMO_LEVERAGE.
const FAVOUR_DRIFT = 0.00019;
// Countervailing drift during a pullback beat — enough to visibly retrace
// without threatening the no-loss invariant.
const PULLBACK_DRIFT = -0.00016;

/** A pullback beat: every so often the move retraces briefly. */
export interface Pullback {
  /** ms into the position when the retrace starts. */
  at: number;
  /** ms the retrace lasts. */
  duration: number;
}

// Retraces are scheduled rather than random so the demo always LOOKS like a
// real move (never a straight ramp) while staying reproducible.
const PULLBACKS: Pullback[] = [
  { at: 1500, duration: 700 },
  { at: 3400, duration: 620 },
  { at: 5600, duration: 560 },
  { at: 7800, duration: 600 },
];

/**
 * Drift to apply this tick, given the position direction and how long it has
 * been open. Returns a signed per-tick fraction for SimFeed.setDrift().
 */
export function driftFor(direction: Direction, elapsedMs: number): number {
  const sign = direction === "long" ? 1 : -1;
  const inPullback = PULLBACKS.some(
    (p) => elapsedMs >= p.at && elapsedMs < p.at + p.duration
  );
  const magnitude = inPullback ? PULLBACK_DRIFT : FAVOUR_DRIFT;
  return sign * magnitude;
}

/** True while a scheduled retrace is running (used to damp noise slightly). */
export function inPullback(elapsedMs: number): boolean {
  return PULLBACKS.some(
    (p) => elapsedMs >= p.at && elapsedMs < p.at + p.duration
  );
}

/**
 * PnL for a demo position, in dollars.
 *
 * Clamped at >= 0: the landing page is a promise, not a simulation of risk, and
 * the brief is explicit that the demo never shows a loss. The pullbacks still
 * read as real because PnL visibly retreats toward zero before resuming.
 */
export function demoPnl(
  direction: Direction,
  entry: number,
  price: number
): number {
  const move = (price - entry) / entry;
  const signed = direction === "long" ? move : -move;
  const raw = signed * DEMO_SIZE * DEMO_LEVERAGE;
  return Math.max(0, raw);
}

/** Liquidation price for the demo overlay (never actually reached). */
export function demoLiquidation(direction: Direction, entry: number): number {
  const buffer = 1 / DEMO_LEVERAGE;
  return direction === "long" ? entry * (1 - buffer) : entry * (1 + buffer);
}
