import type { Direction, Position } from "@/types";

// Shared perpetual math used by the demo simulator and by live PnL display.
// Conventions: `margin` is the USD collateral the user puts up; notional =
// margin * leverage; size (base asset) = notional / entryPrice.

export function computeSize(
  marginUsd: number,
  leverage: number,
  entryPrice: number
): number {
  if (entryPrice <= 0) return 0;
  return (marginUsd * leverage) / entryPrice;
}

/** Unrealized PnL in USD at the current price. */
export function unrealizedPnl(
  direction: Direction,
  size: number,
  entryPrice: number,
  currentPrice: number
): number {
  const diff = currentPrice - entryPrice;
  const signed = direction === "long" ? diff : -diff;
  return signed * size;
}

/** ROI on margin (fraction; multiply by 100 for %). */
export function roi(pnl: number, marginUsd: number): number {
  return marginUsd > 0 ? pnl / marginUsd : 0;
}

/**
 * DEMO display PnL at the current MagicBlock price. (Live PnL comes straight
 * from Bulk's real unrealizedPnl — do not use this for live.)
 */
export function demoPnlAt(pos: Position, currentPrice: number | undefined): number {
  if (currentPrice == null) return pos.unrealizedPnl;
  return unrealizedPnl(pos.direction, pos.size, pos.entryPrice, currentPrice);
}

/**
 * Liquidation price — where losses consume the margin. Simplified isolated-margin
 * model (no fees/funding): long liquidates below entry, short above.
 */
export function liquidationPrice(
  direction: Direction,
  entryPrice: number,
  leverage: number
): number {
  if (leverage <= 0) return 0;
  const move = entryPrice / leverage;
  return direction === "long" ? entryPrice - move : entryPrice + move;
}

/** Build a fresh position from an entry (used by the demo simulator). */
export function openPosition(params: {
  symbol: Position["symbol"];
  direction: Direction;
  marginUsd: number;
  leverage: number;
  entryPrice: number;
}): Position {
  const { symbol, direction, marginUsd, leverage, entryPrice } = params;
  const size = computeSize(marginUsd, leverage, entryPrice);
  return {
    symbol,
    direction,
    size,
    entryPrice,
    leverage,
    liquidationPrice: liquidationPrice(direction, entryPrice, leverage),
    marginUsed: marginUsd,
    unrealizedPnl: 0,
    openedAt: Date.now(),
  };
}

/** Whether the current price has hit the liquidation level. */
export function isLiquidated(pos: Position, currentPrice: number): boolean {
  return pos.direction === "long"
    ? currentPrice <= pos.liquidationPrice
    : currentPrice >= pos.liquidationPrice;
}

// --- Trailing stop -----------------------------------------------------------
//
// A trailing stop sits in the PROFIT zone (between entry and mark) and only
// ratchets in the profit direction — for a long it can only climb, for a short
// only fall. It is CLAMPED to entry so it can never lock a loss: a trail always
// closes in profit (worst case ~breakeven at entry). You can only arm it once
// price is more than `trailPct` in your favor, otherwise the line would land at
// or below entry (see canTrail).

/**
 * Raw trail stop `trailPct` behind a reference price, then clamped to entry so
 * it never crosses into loss. Long: stop below price but ≥ entry. Short: stop
 * above price but ≤ entry.
 */
export function trailStopFor(
  direction: Direction,
  refPrice: number,
  entryPrice: number,
  trailPct: number
): number {
  if (direction === "long") {
    return Math.max(refPrice * (1 - trailPct), entryPrice);
  }
  return Math.min(refPrice * (1 + trailPct), entryPrice);
}

/**
 * Ratchet an existing trail stop toward profit only — it never moves backward,
 * and never crosses entry. Long: only rises; short: only falls.
 */
export function ratchetTrail(
  direction: Direction,
  currentStop: number,
  entryPrice: number,
  currentPrice: number,
  trailPct: number
): number {
  const candidate = trailStopFor(direction, currentPrice, entryPrice, trailPct);
  return direction === "long"
    ? Math.max(currentStop, candidate)
    : Math.min(currentStop, candidate);
}

/** Whether price has crossed the trail stop (position should auto-close). */
export function trailHit(
  direction: Direction,
  stopPrice: number,
  currentPrice: number
): boolean {
  return direction === "long"
    ? currentPrice <= stopPrice
    : currentPrice >= stopPrice;
}

/**
 * Whether a trail can be armed right now: the position must be in profit by MORE
 * than the trail distance, so the clamped stop lands strictly above entry (long)
 * / below entry (short) — i.e. it actually locks profit rather than sitting at
 * breakeven. Needs a small buffer beyond trailPct so there's room to work.
 */
export function canTrail(
  direction: Direction,
  entryPrice: number,
  currentPrice: number,
  trailPct: number
): boolean {
  const profitFrac =
    direction === "long"
      ? currentPrice / entryPrice - 1
      : 1 - currentPrice / entryPrice;
  return profitFrac > trailPct;
}
