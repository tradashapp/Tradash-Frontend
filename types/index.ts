// Shared domain types used across slices, hooks, and integration clients.

export type MarketSymbol = "BTC" | "ETH" | "SOL";

export type Direction = "long" | "short"; 

/** Trading account. Mirrors the slice's TradingMode; kept here to avoid a
 * circular import (the slice imports from this module). */
export type TradingMode = "demo" | "live"; 

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
   * Live PnL anchoring (Bulk only pushes PnL on trade events, not per tick). We
   * record Bulk's real PnL and the MagicBlock price at the moment of each Bulk
   * update, then interpolate between updates using MagicBlock price movement:
   *   pnl = pnlAnchor + (mbNow − priceAnchorMb) × size × dir
   * This stays truthful (re-syncs to Bulk each update) AND smooth (moves per
   * frame with the chart). Absent for demo.
   */
  pnlAnchor?: number;
  priceAnchorMb?: number;
  /**
   * MagicBlock price at the moment the order was tapped — used ONLY to draw the
   * entry line where the user clicked on the chart. PnL is unaffected (Bulk-
   * anchored). Falls back to entryPrice if absent.
   */
  chartEntryPrice?: number;
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

/** What produced a history row. `close` = full exit (round-trip). `add` =
 *  increased size (no realized PnL). `reduce` = partial close (realizes part).
 *  Absent on older rows → treat as `close`. */
export type TradeEventKind = "close" | "add" | "reduce";

export interface CompletedTrade {
  id: string;
  /** Which account produced it: demo (localStorage) or live (backend). */
  mode: TradingMode;
  /** The event this row records. Defaults to `close` when absent. */
  kind?: TradeEventKind;
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
