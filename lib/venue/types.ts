import type { MarketSymbol, ProtectionOrder } from "@/types";

/**
 * THE VENUE SEAM.
 *
 * `ExecutionVenue` is the one interface the app trades through. Everything
 * venue-specific — wire formats, signing, order encoding, error dialects —
 * lives behind an adapter that implements it (`lib/venue/bulk.ts` today,
 * Phoenix next). Nothing above this line should import `lib/bulk/*`.
 *
 * WHAT THIS DELIBERATELY DOES NOT ABSTRACT
 *
 * Market data and funding (deposits/withdrawals) are NOT here. They are
 * separate concerns with different security models — funding is owner-signed
 * and must never be reachable by a delegated trading key — and folding them in
 * would put withdrawal code behind an interface the agent key can call. They
 * get their own seams later (see PHOENIX_MIGRATION_FEASIBILITY.md §16).
 *
 * History is not here either: it is written by the app into Tradash's own
 * database, not read back from the venue.
 *
 * SIZES ARE BASE ASSET, PRICES ARE VENUE SPACE
 *
 * `size` is always the base asset (0.009 BTC, 5 SOL) — never USD. Prices are
 * in the VENUE's own price space, not the chart's MagicBlock space; callers
 * translate at the boundary (see `lib/perp.ts`). Getting this backwards puts
 * a trigger tens of dollars off on every order.
 */

/**
 * Who signs. Opaque on purpose: Bulk signs an off-chain payload with a WASM
 * keychain, Phoenix signs a Solana transaction with a delegate keypair. The app
 * only needs to know a signer exists and which account it acts for.
 */
export interface VenueSigner {
  /** The delegated session key's public key. */
  pubkey: string;
  /** The master/owner account this signer trades on behalf of. */
  account: string;
}

/** Open (or add to) a position at market. */
export interface OpenOrderRequest {
  symbol: MarketSymbol;
  isLong: boolean;
  /** Base-asset size. */
  size: number;
  /** Current price, used for the slippage bound. Venue price space. */
  refPrice: number;
}

/** Reduce or fully close a position at market (reduce-only, opposite side). */
export interface ReduceOrderRequest {
  symbol: MarketSymbol;
  /** Direction of the EXISTING position; the venue sends the opposite side. */
  positionIsLong: boolean;
  /** Base-asset size to reduce. */
  size: number;
  refPrice: number;
}

/** Protective triggers to rest against a position. `null` clears that leg. */
export interface ProtectionRequest {
  symbol: MarketSymbol;
  /** Direction of the position being protected. */
  positionIsLong: boolean;
  /** Base-asset size the triggers should cover. */
  size: number;
  /** Take-profit trigger price, venue space. `null` = none. */
  takeProfit: number | null;
  /** Stop-loss trigger price, venue space. `null` = none. */
  stopLoss: number | null;
  /** Trailing stop distance in basis points. `null` = none. */
  trailBps: number | null;
  /** Triggers currently resting, so the venue can replace rather than duplicate. */
  existing: ProtectionOrder[] | undefined;
}

export interface ExecutionVenue {
  /** Stable id for logging and feature flags. */
  readonly id: "bulk" | "phoenix";

  /**
   * Set leverage for a market, where the venue models leverage as an account
   * setting.
   *
   * Returns `false` when the venue has no such concept — Phoenix derives
   * leverage from position-size tiers and cannot be told a value. Callers must
   * treat `false` as "not applicable", never as failure, and must not block a
   * trade on it. Kept explicit rather than silently no-op'd so the difference
   * stays visible at the call site.
   */
  setLeverage(
    signer: VenueSigner,
    symbol: MarketSymbol,
    leverage: number
  ): Promise<boolean>;

  /** Open or add to a position at market. Rejects on venue error. */
  openMarket(signer: VenueSigner, req: OpenOrderRequest): Promise<void>;

  /** Reduce or close a position at market. Rejects on venue error. */
  reduceMarket(signer: VenueSigner, req: ReduceOrderRequest): Promise<void>;

  /**
   * Place/replace protective triggers, and verify they actually rest.
   *
   * Verification is part of the contract, not an implementation detail: Bulk
   * acknowledges a malformed trigger with a real order id and then silently
   * discards it, so an ack is not proof. An implementation MUST confirm the
   * orders are actually resting before resolving, and reject otherwise.
   */
  setProtection(
    signer: VenueSigner,
    req: ProtectionRequest
  ): Promise<ProtectionOrder[]>;

  /**
   * Cancel every protective trigger for a market.
   *
   * Called after a close: a venue may leave triggers resting against a flat
   * account, where they would fire on whatever position the user opens next.
   */
  cancelAllProtection(
    signer: VenueSigner,
    symbol: MarketSymbol,
    existing: ProtectionOrder[] | undefined
  ): Promise<void>;

  /**
   * Does this error mean the venue refuses our builder/referral code?
   *
   * Bulk exposes no readable approval state, so a rejection is the only
   * authoritative signal that the optimistic cache is wrong. Venues that attach
   * builder fees per-request (Phoenix Flight) have no such state and return
   * `false` always.
   */
  isBuilderNotApprovedError(e: unknown): boolean;
}
