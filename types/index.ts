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
}

export interface Balance {
  /** Total account equity (Bulk: collateral + Bulk's own unrealized PnL). */
  equity: number;
  /** Free balance available for new margin. */
  available: number;
  /** Margin currently locked in open positions. */
  marginUsed: number;
  /**
   * Bulk's own unrealized PnL already baked into `equity`. We subtract it to get
   * the realized base, then re-add our MagicBlock-derived display PnL so the
   * floating balance tracks the chart without double-counting.
   */
  unrealizedPnl?: number;
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
