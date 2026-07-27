// Shared domain types used across slices, hooks, and integration clients.

export type MarketSymbol = "BTC" | "ETH" | "SOL";

export type Direction = "long" | "short";

export interface MarketInfo {
  symbol: MarketSymbol;
  /** Bulk market identifier, e.g. "BTC-USD". */
  bulkSymbol: string;
  /** Human label. */
  label: string;
  /** Pyth Lazer feed id — used as the oracle PDA seed (as a string). */
  pythLazerId: number;
  /** Price scaling exponent; USD price = rawI64 * 10^exponent. */
  exponent: number;
  /** Public path to the asset logo. */
  logo: string;
}

export interface Position {
  symbol: MarketSymbol;
  direction: Direction;
  /** Base-asset size (signed handled by direction). */
  size: number;
  entryPrice: number;
  leverage: number;
  liquidationPrice: number;
  marginUsed: number;
  unrealizedPnl: number;
  /** ms epoch when opened. */
  openedAt: number;
  /** Trailing stop: active flag + the current stop price (ratchets toward profit). */
  trailActive?: boolean;
  trailStopPrice?: number;
  /**
   * Feed basis for live positions: (Bulk entry price − MagicBlock price at open).
   * The chart runs on MagicBlock prices, so we subtract this from the Bulk entry
   * to place the entry line where the MagicBlock line actually was at entry —
   * keeping chart PnL/color consistent with Bulk's direction. 0 for demo.
   */
  entryBasis?: number;
}

export interface Balance {
  /** Total account equity. */
  equity: number;
  /** Free balance available for new margin. */
  available: number;
  /** Margin currently locked in open positions. */
  marginUsed: number;
}

export type OrderStatus =
  | "idle"
  | "submitting"
  | "filled"
  | "rejected"
  | "error";

export interface CompletedTrade {
  id: string;
  symbol: MarketSymbol;
  direction: Direction;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  size: number;
  pnl: number;
  roi: number;
  /** ms duration held. */
  durationMs: number;
  openedAt: number;
  closedAt: number;
}
