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
