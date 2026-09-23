"use client";

import { unrealizedPnl } from "@/lib/perp";
import type { StoredOpenPosition } from "./openPositionStore";
import type { Position } from "@/types";

/**
 * Turn a position we last saw OPEN, but which Bulk now reports flat, back into
 * something `recordClose` can log.
 *
 * This is the missing-history repair path: a TP / SL / trailing stop (or a
 * liquidation) fires server-side while the app is closed, so no open→absent
 * transition is ever observed and the trade is never recorded. See
 * `openPositionStore` for the full sequence.
 *
 * ── THE HONEST-EXIT PROBLEM ──────────────────────────────────────────────────
 * We know the position closed. We do NOT know the price it closed at — the app
 * wasn't running, and `/account` no longer carries the position at all. Three
 * candidates, in descending order of truthfulness:
 *
 *   1. A resting trigger level. If the position had a TP at 65,000 and it is now
 *      flat, 65,000 is very likely the exact fill. Best available answer.
 *   2. The current market price. Only defensible if the close just happened; an
 *      hour later it is unrelated to the exit, and recording it can flip a
 *      take-profit into a recorded LOSS.
 *   3. The entry price (PnL 0). Wrong, but wrong in the one direction that
 *      cannot fabricate a win or a loss.
 *
 * We pick the trigger CLOSEST to the current price, because that is the one
 * price actually had to reach. With no triggers stored we fall back to the
 * current price, and with no price at all to the entry.
 *
 * `confident` reports which world we are in, so the caller can decide what to
 * do with a row whose exit is a guess rather than an observation.
 */
export interface ReconciledClose {
  /** The position as it was, ready for `recordClose`. */
  position: Position;
  exitPrice: number;
  pnl: number;
  /** True when the exit came from a resting trigger rather than a guess. */
  confident: boolean;
}

export function reconcileClose(
  stored: StoredOpenPosition,
  currentPrice: number | undefined
): ReconciledClose {
  const triggers = (stored.triggers ?? []).filter(
    (t) => Number.isFinite(t.triggerPrice) && t.triggerPrice > 0
  );

  let exitPrice: number;
  let confident = false;

  if (triggers.length > 0 && currentPrice != null && currentPrice > 0) {
    // Several triggers can rest at once (a TP and an SL bracket). Only one
    // fired, and we cannot see which — so take the one nearest where price
    // actually is now, which is the one it most plausibly crossed.
    const nearest = triggers.reduce((best, t) =>
      Math.abs(t.triggerPrice - currentPrice) <
      Math.abs(best.triggerPrice - currentPrice)
        ? t
        : best
    );
    exitPrice = nearest.triggerPrice;
    confident = true;
  } else if (triggers.length === 1) {
    // No current price to compare against, but exactly one trigger rested —
    // there is nothing to disambiguate, so it is still the best answer.
    exitPrice = triggers[0].triggerPrice;
    confident = true;
  } else if (currentPrice != null && currentPrice > 0) {
    exitPrice = currentPrice;
  } else {
    exitPrice = stored.entryPrice;
  }

  const position: Position = {
    symbol: stored.symbol,
    direction: stored.direction,
    size: stored.size,
    entryPrice: stored.entryPrice,
    leverage: stored.leverage,
    liquidationPrice: 0,
    marginUsed: stored.marginUsed,
    unrealizedPnl: stored.unrealizedPnl,
    openedAt: stored.openedAt,
  };

  // Derived from the exit we settled on rather than reusing the stored
  // `unrealizedPnl`: that figure is as old as the last moment the tab was open,
  // so on a stop that fired hours later it describes a completely different
  // price. Deriving it keeps PnL, exit price and ROI telling ONE consistent
  // story, which is what history, stats and the leaderboard all read.
  const pnl = unrealizedPnl(
    stored.direction,
    stored.size,
    stored.entryPrice,
    exitPrice
  );

  return { position, exitPrice, pnl, confident };
}
