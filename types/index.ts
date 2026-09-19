// Shared domain types used across slices, hooks, and integration clients.

/** A supported market's base asset, e.g. "BTC". The authoritative set is the
 * keys of MARKETS in lib/markets.ts — use isMarketSymbol() to narrow a string
 * (e.g. a URL slug) before treating it as one. */
export type MarketSymbol = string;

/** Filter pills above the market list. "favourites" is user state, not a
 * property of the market itself. */
export type MarketCategory =
  | "favourites"
  | "all"
  | "hot"
  | "crypto"
  | "stocks";

export type Direction = "long" | "short"; 

/** Trading account. Mirrors the slice's TradingMode; kept here to avoid a
 * circular import (the slice imports from this module). */
export type TradingMode = "demo" | "live";     

export interface MarketInfo {
  symbol: MarketSymbol; 
  /** Bulk market identifier, e.g. "BTC-USD". */  
  bulkSymbol: string;
  /**
   * Phoenix market identifier, e.g. "BTC" — bare, with no quote suffix.
   *
   * Absent when Phoenix does not list the market. `MARKETS` is the intersection
   * of Bulk and the MagicBlock oracle, so a few entries have no Phoenix
   * counterpart; the venue adapter must reject those rather than guess a symbol.
   */
  phoenixSymbol?: string;
  /** Human label. */
  label: string;
  /** Pyth Lazer feed id — used as the oracle PDA seed (as a string). */
  pythLazerId: number;
  /** Price scaling exponent; USD price = rawI64 * 10^exponent. */
  exponent: number;
  /** Max leverage Bulk allows on this market (from exchangeInfo). */
  maxLeverage: number;
  /**
   * Smallest tradable size increment, from exchangeInfo's `lotSize`
   * (verified live 2026-09-16). Bulk stores sizes as fixed-point and REJECTS
   * any order whose size is not representable, with
   *   422 `m.sz: f64 must be finite, positive, and within fixed-point range`
   * so every outgoing size must be floored to a multiple of this.
   */
  lotSize: number;
  /** Public path to the asset logo. */
  logo: string;
  /** Static categories this market belongs to (excludes "favourites"). */
  categories: MarketCategory[];
}

/** Which protective trigger a resting order is. Mirrors Bulk's `orderType`. */
export type ProtectionKind = "takeProfit" | "stop" | "trailing";

/**
 * One protective trigger order resting on Bulk against a position.
 *
 * `triggerPrice` is the level that fires it, in BULK's price space.
 * `isAbove` is the DIRECTION price must cross to fire — which, for the same
 * position, differs between TP and SL (see lib/bulk/protection.ts).
 */
export interface ProtectionOrder {
  orderId: string;
  kind: ProtectionKind;
  triggerPrice: number;
  isAbove: boolean;
  /** Trailing only: distance behind the high-water mark, in basis points. */
  trailBps?: number;
  /** Trailing only: the best price reached so far, which the stop trails. */
  highWaterPrice?: number;
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
   * Protective trigger orders resting on BULK for this position (TP / SL /
   * trailing), read back from `positions[].protection.orders`.
   *
   * These rest SERVER-SIDE and fire whether or not the app is open, so this is
   * the authoritative view — never a local intent. A level the user just set
   * does not belong here until Bulk has echoed it back (see `readProtection`).
   * Prices are in BULK's price space, like entryPrice / liquidationPrice.
   */
  protection?: ProtectionOrder[];
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
  /**
   * Bulk's OWN mark price (`fairPrice`) for this market, as of the last update.
   *
   * Bulk quotes entryPrice / liquidationPrice against THIS feed, while the
   * chart's Y axis is the MagicBlock oracle. The difference between this and
   * the MagicBlock price at the same instant IS the offset between the two
   * price spaces, so every Bulk-quoted line can be translated with one
   * measured shift rather than each being inferred separately. Live only.
   */
  markPriceBulk?: number;
  /**
   * Fees and funding already charged against this position, signed the way
   * Bulk reports it (negative = the user has paid). Used to draw the true
   * break-even line — the price at which closing nets zero AFTER costs.
   */
  realizedPnl?: number;
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

/**
 * A span of wall-clock time during which we recorded NOTHING — the tab was
 * closed, backgrounded, or the oracle dropped. Stored explicitly so the player
 * can draw the hole instead of smoothing a line across it, which would invent
 * price action the user never saw.
 */
export interface ReplayGap {
  /** ms epoch the gap starts (last sample before it). */
  from: number;
  /** ms epoch the gap ends (first sample after it). */
  to: number;
  /** True once klines backfill filled this span at 1m granularity. */
  filled?: boolean;
}

/**
 * The recorded price path of ONE position lifecycle, encoded compactly.
 *
 * Samples are stored as tick-quantized deltas against `entry` rather than
 * absolute floats: a 900-sample path serializes to ~1.2-4.3KB instead of ~15KB,
 * which is what makes storing demo replays in localStorage viable at all.
 *
 * Reconstruct sample i as: price = entry + d[i] * tick, at time t0 + i*(1000/hz).
 */
export interface TradePath {
  /** ms epoch of the first sample. */
  t0: number;
  /** Samples per second. Halves as the buffer downsamples on long holds. */
  hz: number;
  /** Reference price the deltas are relative to (the position's entry). */
  entry: number;
  /** Quantization step the deltas are expressed in. */
  tick: number;
  /** Tick-quantized deltas from `entry`, one per sample. */
  d: number[];
}

/**
 * One position lifecycle's recording. Keyed by `id`, referenced by every
 * CompletedTrade row the position produced (open/add/reduce/close) — they all
 * replay the SAME path and differ only in which moment they seek to.
 */
export interface TradeEpisode {
  id: string;
  mode: TradingMode;
  symbol: MarketSymbol;
  direction: Direction;
  openedAt: number;
  /** ms epoch the position went flat. Absent while still open. */
  closedAt?: number;
  /**
   * The price the CHART drew the entry line at — the break-even MagicBlock
   * price, NOT Bulk's entryPrice. Replay must match what the user actually saw.
   */
  entryLine: number;
  liqLine?: number;
  path: TradePath;
  /** Spans with no recorded data. Empty when the app stayed open throughout. */
  gaps: ReplayGap[];
  /**
   * Fraction of the position's wall-clock duration we actually have data for
   * (0..1). Gates whether the row is tappable — see isReplayable().
   */
  coverage: number;
}

export interface CompletedTrade {
  id: string;
  /** Which account produced it: demo (localStorage) or live (backend). */
  mode: TradingMode;
  /**
   * The position lifecycle this row belongs to. Multiple rows (open/add/reduce/
   * close) share one episode and therefore one replay. Absent on rows recorded
   * before replay shipped, and whenever recording was unavailable.
   */
  episodeId?: string;
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

// Leaderboard -----------------------------------------------------------------

/** How the leaderboard is ranked. */
export type LeaderboardMetric = "pnl" | "roi";

/** The window standings are computed over. */
export type LeaderboardPeriod = "daily" | "weekly" | "monthly" | "all";

/**
 * One ranked trader. `rank` is 1-based; 0 means the user traded in the window
 * but doesn't qualify for this board (see the ROI volume floor), so the UI
 * shows their figures without a position.
 */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  /** Display handle WITHOUT the leading "@" — the UI adds it. */
  username: string;
  avatarUrl: string | null;
  /** Linked X handle WITHOUT the leading "@". Null when X isn't linked. */
  twitterHandle: string | null;
  pnl: number;
  /** Capital-weighted return over the window: sum(pnl) / sum(USD notional). */
  roi: number;
  volume: number;
  trades: number;
  wins: number;
}

/**
 * A leaderboard page. `me` is the signed-in user's own standing — present even
 * when they rank outside the visible top slice, so the table can pin it.
 */
export interface Leaderboard {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

/** Public profile shown when a leaderboard row is tapped. */
export interface TraderProfile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  /** Linked X handle WITHOUT the leading "@". Null when X isn't linked. */
  twitterHandle: string | null;
  pnl: number;
  roi: number;
  volume: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  recentTrades: CompletedTrade[];
}
