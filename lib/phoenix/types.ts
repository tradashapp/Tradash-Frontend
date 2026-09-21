/**
 * Phoenix wire types.
 *
 * Every shape here was read off a LIVE response on 2026-09-18, not from the
 * docs — the published route prefix was wrong (`/v1/exchange/...` 404s; the
 * real one is `/v1/view/...`), so the docs are not a reliable source for this
 * file. See PHOENIX_MIGRATION_FEASIBILITY.md Appendix A.
 */

/**
 * Phoenix returns money as an integer plus its decimals, never a float.
 *
 * `value` is the raw integer, `ui` the pre-divided decimal STRING. Use `value`
 * and `decimals` for arithmetic; `ui` exists so a display path never has to
 * reconstruct it. Do not parse `ui` for maths — it is formatted, not exact.
 */
export interface PhoenixAmount {
  value: number;
  decimals: number;
  ui: string;
}

/** One rung of a market's leverage ladder. */
export interface PhoenixLeverageTier {
  maxLeverage: number;
  /** Upper bound of this tier, in BASE LOTS (divide by 10^baseLotsDecimals). */
  maxSizeBaseLots: number;
  limitOrderRiskFactor: number;
  limitOrderRiskFactorBps: number;
}

export interface PhoenixMarket {
  symbol: string;
  assetId: number;
  /** "active" | "gated" | "closed" — a MARKET lifecycle state, not a user permission. */
  marketStatus: string;
  marketPubkey: string;
  tickSize: number;
  /** Base lot size = 10^-baseLotsDecimals. BTC 4 → 0.0001 BTC per lot. */
  baseLotsDecimals: number;
  takerFee: number;
  makerFee: number;
  leverageTiers: PhoenixLeverageTier[];
  fundingIntervalSeconds: number;
  isolatedOnly: boolean;
  metadata?: { name?: string | null; logoUri?: string | null };
}

/** Per-market position row. Prices/sizes come in both lots and human units. */
/**
 * One open position, as `/v1/view/trader/{pda}` serves it.
 *
 * EVERY NUMERIC FIELD IS A `PhoenixAmount`, not a string. An earlier revision of
 * this API returned flat strings (`basePositionUnits`, `entryPriceUsd`,
 * `basePositionLots`, …) and those names are simply gone — reading them yields
 * `undefined`, which silently parsed as "no position" while the top-level
 * balance fields kept working, so an open position showed in the balance pill
 * and nowhere else. Verified live 2026-09-21.
 *
 * `liquidationPrice`, `initialMargin` and per-position `unrealizedPnl` are now
 * SERVED. They used to be computed client-side (or stubbed at 0); prefer these.
 */
export interface PhoenixPositionRow {
  symbol?: string;
  /** Signed: negative = short. Human units — already lot-scaled. */
  positionSize: PhoenixAmount;
  /** Signed quote exposure; negative on a long. */
  virtualQuotePosition: PhoenixAmount;
  entryPrice: PhoenixAmount;
  unrealizedPnl: PhoenixAmount;
  discountedUnrealizedPnl: PhoenixAmount;
  /** Margin locked by THIS position — Phoenix's answer to `marginUsed`. */
  positionInitialMargin: PhoenixAmount;
  initialMargin: PhoenixAmount;
  maintenanceMargin: PhoenixAmount;
  backstopMargin: PhoenixAmount;
  limitOrderMargin: PhoenixAmount;
  /** Notional at the mark. */
  positionValue: PhoenixAmount;
  unsettledFunding: PhoenixAmount;
  accumulatedFunding: PhoenixAmount;
  /** Served directly — no longer derived from the margin calculator. */
  liquidationPrice: PhoenixAmount | null;
  takeProfitPrice: PhoenixAmount | null;
  stopLossPrice: PhoenixAmount | null;
}

/**
 * Trader state for ONE subaccount.
 *
 * `/v1/view/trader/{pda}` is scoped to a single subaccount — a trader active on
 * another subaccount reads as empty here. For the whole portfolio use
 * `/v1/trader/state/{authority}`.
 */
export interface PhoenixTraderState {
  traderKey: string;
  authority: string;
  traderPdaIndex: number;
  traderSubaccountIndex: number;
  /**
   * "uninitialized" | "cold" | "active" | "reduceOnly" | "frozen".
   *
   * A STORAGE-RESIDENCY tier, not an activity log: Phoenix keeps hot traders in
   * an on-chain ActiveTraderBuffer and idle accounts fall back to "cold"
   * regardless of history. A market order warms the account. Never read "cold"
   * as "has never traded".
   */
  state: string;
  capabilities: Record<string, { immediate: boolean; viaColdActivation?: boolean }>;
  collateralBalance: PhoenixAmount;
  effectiveCollateral: PhoenixAmount;
  withdrawableQuoteCollateral: PhoenixAmount;
  unrealizedPnl: PhoenixAmount;
  unsettledFundingOwed: PhoenixAmount;
  accumulatedFunding: PhoenixAmount;
  portfolioValue: PhoenixAmount;
  maintenanceMargin: PhoenixAmount;
  initialMargin: PhoenixAmount;
  riskState: string;
  riskTier: string;
  positions: PhoenixPositionRow[];
  limitOrders: Record<string, unknown>;
  makerFeeOverrideMultiplier: number;
  takerFeeOverrideMultiplier: number;
  maxPositions: number;
}

/** One fill. `fillId` and `signature` are both natural idempotency keys. */
export interface PhoenixFill {
  marketSymbol: string;
  signature: string;
  fillId: string;
  /** ISO 8601. */
  timestamp: string;
  slot: number;
  instructionType: string;
  baseLotsBefore: string;
  baseLotsAfter: string;
  baseLotsDelta: string;
  price: string;
  /** Server-computed — Tradash derives this client-side on Bulk. */
  realizedPnl: string;
  fees: string;
  liquidity: "taker" | "maker";
  tradeType: string;
  subaccountIndex: number;
}

export interface PhoenixCandle {
  /** MILLISECONDS since epoch. Seconds silently return an empty bar set. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Mark-price OHLC, alongside last-price OHLC. */
  markOpen: number;
  markHigh: number;
  markLow: number;
  markClose: number;
  volume?: number;
  /** False while the bucket is still updating. */
  isFinal: boolean;
}
