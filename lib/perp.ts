import { currentBuilderFeeBps } from "@/lib/bulk/feeArrangement";
import { isBulkPriced } from "@/lib/markets";
import type { Balance, Direction, Position } from "@/types";

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
 * USD notional an event traded — the inverse of `computeSize`.
 *
 * `size` is BASE ASSET (0.009 BTC, 5 SOL), never dollars, so it must never be
 * summed or formatted as money directly: 0.009 BTC + 5 SOL = "5.009" is adding
 * incommensurable units, and the result is dominated by whichever market has
 * the cheapest unit. Volume totals therefore have to convert per row, at that
 * row's own price, BEFORE summing — which is what this is for.
 *
 * Priced at entry rather than exit: volume measures the size of the bet that
 * was placed, so it shouldn't move with the outcome. (Exchanges that count both
 * legs of a round trip report roughly double this; one trade counted once is
 * the more honest reading of "volume traded" for a single account, and it keeps
 * `add`/`reduce`/`close` rows summing to the notional each one actually moved.)
 */
export function notionalUsd(size: number, entryPrice: number): number {
  return Math.abs(size) * entryPrice;
}

/**
 * USD margin an event put up = notional / leverage. The capital actually at
 * risk, as opposed to the leveraged exposure `notionalUsd` reports.
 */
export function marginUsd(
  size: number,
  entryPrice: number,
  leverage: number
): number {
  if (leverage <= 0) return 0;
  return notionalUsd(size, entryPrice) / leverage;
}

/**
 * DEMO display PnL at the current MagicBlock price. (Live uses livePnlAt.)
 */
export function demoPnlAt(pos: Position, currentPrice: number | undefined): number {
  if (currentPrice == null) return pos.unrealizedPnl;
  return unrealizedPnl(pos.direction, pos.size, pos.entryPrice, currentPrice);
}

/**
 * LIVE display PnL: anchored to Bulk's real PnL (truth), interpolated smoothly
 * with MagicBlock price movement since the anchor. Every Bulk WS update resets
 * the anchor, so this re-syncs to the exact real number and never drifts far.
 *   pnl = pnlAnchor + (mbNow − priceAnchorMb) × size × dir
 */
export function livePnlAt(pos: Position, mbNow: number | undefined): number {
  const anchor = pos.pnlAnchor ?? pos.unrealizedPnl;
  if (mbNow == null || pos.priceAnchorMb == null) return anchor;
  const dir = pos.direction === "long" ? 1 : -1;
  return anchor + (mbNow - pos.priceAnchorMb) * pos.size * dir;
}

/**
 * LIVE account value: Bulk collateral plus the open positions' live PnL.
 *
 * Bulk's `totalMargin` is COLLATERAL ONLY — deposits plus settled PnL, minus
 * fees and funding. It does NOT include open positions' unrealized PnL (the
 * docs' own example reads `totalBalance: 100000.0` beside
 * `unrealizedPnl: 567.8`). So open PnL is simply added on top.
 *
 * This used to be `equity − pnlAnchor + livePnl`, which assumed Bulk had baked
 * the anchored PnL into equity. It only looked right while the anchor was ~0,
 * i.e. in the session that opened the trade. After a reload (or an add, which
 * re-anchors) the anchor was the full open PnL, and the balance snapped back to
 * the pre-trade collateral and then tracked only the PnL made since.
 */
export function liveAccountValue(equity: number, openPnl: number): number {
  return equity + openPnl;
}

/** Display PnL for either mode. */
export function displayPnlFor(
  mode: "demo" | "live",
  pos: Position,
  mbNow: number | undefined
): number {
  return mode === "demo" ? demoPnlAt(pos, mbNow) : livePnlAt(pos, mbNow);
}

/**
 * THE TWO PRICE SPACES.
 *
 * The chart's Y axis is the MagicBlock oracle. Bulk quotes `entryPrice`,
 * `liquidationPrice` and `fairPrice` against ITS OWN feed — a different source
 * that sits a little either side of MagicBlock's. Drawing a Bulk-quoted price
 * straight onto the chart therefore lands it off by the spread between the two
 * feeds, and moves it as that spread changes.
 *
 * Every Bulk-derived line is drawn through ONE measured shift, so the whole set
 * (entry, liquidation, break-even) keeps Bulk's real geometry and simply slides
 * into the chart's space together. Because the shift is common to all of them,
 * the DISTANCES between the lines are exactly the ones Bulk reported.
 *
 * shift = (where the chart says we are) − (where Bulk says we are)
 *       = mbNow − fairPrice
 *
 * Preferred source is Bulk's own `fairPrice` at the same instant as the
 * MagicBlock anchor — a direct measurement of the offset. When Bulk did not
 * send a mark (older payloads / partial deltas) we fall back to inferring the
 * same quantity from PnL, which is what this file did before `fairPrice` was
 * captured: solving `pnlAnchor + (p − priceAnchorMb)·size·dir = 0` yields the
 * MagicBlock price of zero PnL, and subtracting Bulk's entry gives the shift.
 *
 * A Bulk-priced market (`priceSource: "bulk"`) has only ONE space: its chart
 * runs off Bulk's own mark price, so there's nothing to translate and the shift
 * is exactly 0 — not a measured ~0, which would still wobble with the timing
 * between the ticker and the account stream.
 */
export function bulkToChartShift(
  mode: "demo" | "live",
  pos: Position
): number {
  // Demo's prices all come from the one feed — there is nothing to translate.
  if (mode === "demo") return 0;
  // Neither is there when the chart itself is priced off Bulk.
  if (isBulkPriced(pos.symbol)) return 0;

  // Direct: both feeds sampled at the same moment.
  if (
    pos.markPriceBulk != null &&
    pos.priceAnchorMb != null &&
    Number.isFinite(pos.markPriceBulk) &&
    Number.isFinite(pos.priceAnchorMb)
  ) {
    return pos.priceAnchorMb - pos.markPriceBulk;
  }

  // Fallback: infer the same offset from Bulk's PnL.
  const dir = pos.direction === "long" ? 1 : -1;
  const anchor = pos.pnlAnchor ?? pos.unrealizedPnl;
  if (pos.priceAnchorMb == null || pos.size === 0) return 0;
  const zeroPnlMb = pos.priceAnchorMb - anchor / (pos.size * dir);
  const shift = zeroPnlMb - pos.entryPrice;
  return Number.isFinite(shift) ? shift : 0;
}

/**
 * The MagicBlock price at which the displayed PnL reads exactly 0 — i.e. the
 * level where the mark line's profit↔loss color flips. This is where the chart
 * draws its "entry" line, so the line, the moving mark and the gradient all sit
 * in the SAME price space and survive a reload (which loses the tap-time
 * chartEntryPrice but re-anchors from Bulk).
 *
 * This is Bulk's average entry translated into chart space — it deliberately
 * ignores fees and funding, because it marks the point where the POSITION's
 * gross PnL flips sign. For the level where closing actually nets zero after
 * costs, see `netBreakEvenPrice`.
 */
export function breakEvenPrice(
  mode: "demo" | "live",
  pos: Position
): number {
  if (mode === "demo") return pos.entryPrice;
  return pos.entryPrice + bulkToChartShift(mode, pos);
}

/**
 * Bulk's liquidation price, in chart space.
 *
 * Shares the single shift with the entry line, so the gap between them stays
 * exactly the distance Bulk reported — previously this was passed through raw,
 * which put the line off by the feed spread and made the entry→liq gap misread
 * the real risk.
 */
export function chartLiquidationPrice(
  mode: "demo" | "live",
  pos: Position
): number {
  if (mode === "demo") return pos.liquidationPrice;
  return pos.liquidationPrice + bulkToChartShift(mode, pos);
}

/**
 * Bulk's TAKER fee, in basis points of notional. Every Tradash order is a
 * market order (open, close, and TP/SL/trailing exits), so every fill pays it.
 *
 * Bulk exposes no fee schedule over the public API, so this is a constant.
 * Measured 2026-09-27 on mainnet public fills: 3.3 bps for several different
 * takers ($23,595 notional → $7.786 fee). 3.5 is the rate the user gave and
 * sits just above that, which errs the break-even line toward "slightly in
 * profit" — never into a loss.
 */
export const BULK_TAKER_FEE_BPS = 3.5;

/**
 * Fee rate on one fill: Bulk's taker fee plus THIS user's Tradash fee (the
 * server-issued rate, so a fee code's discount counts), as a fraction.
 */
export function fillFeeRate(): number {
  return (BULK_TAKER_FEE_BPS + currentBuilderFeeBps()) / 10_000;
}

/**
 * NET break-even in BULK's price space: the price at which closing the whole
 * position nets ZERO after ALL of its fees — the ones already paid AND the
 * exit fee closing at that price would charge.
 *
 * The entry line answers "where does my PnL flip sign"; this answers "where do
 * I actually get out even". Closing exactly at entry loses the fees, so a long
 * must close ABOVE entry (a short below) to cover:
 *   - costs so far: entry fill fees (Bulk taker + our builder fee) and funding,
 *   - the exit fill's fees, charged on the EXIT notional (p·size).
 *
 *   (p − entry)·size·dir − costsSoFar − p·size·rate = 0
 *     → p = (entry + dir·costsSoFar/size) / (1 − dir·rate)
 *
 * e.g. BTC long, entry $85,000, fees 8.5 bps per fill → B/E ≈ $85,144.6,
 * where gross +$0.1446 on 0.001 BTC exactly pays $0.0723 in + $0.0723 out.
 *
 * `costsSoFar` is Bulk's `realizedPnl` for the position (signed fees + funding,
 * negative = paid), but never less than the entry fee at the full rate: it is
 * unconfirmed whether Bulk counts our builder fee in there, and a fresh
 * position may not have reported costs yet. Taking the larger keeps the line
 * at zero or just above — never a level that closes at a loss.
 *
 * The positions panel quotes Bulk's own numbers, so it shows this directly.
 * The chart uses `netBreakEvenPrice` (identical while the chart runs on Bulk).
 * Null in demo, which charges no fees, and for a zero-size position.
 */
export function netBreakEvenPriceBulk(
  mode: "demo" | "live",
  pos: Position
): number | null {
  if (mode === "demo") return null;
  if (!pos.size || !(pos.entryPrice > 0)) return null;
  const dir = pos.direction === "long" ? 1 : -1;
  const rate = fillFeeRate();
  const reported =
    pos.realizedPnl != null && Number.isFinite(pos.realizedPnl)
      ? -pos.realizedPnl
      : 0;
  const costsSoFar = Math.max(reported, pos.entryPrice * pos.size * rate);
  const price = (pos.entryPrice + (dir * costsSoFar) / pos.size) / (1 - dir * rate);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function netBreakEvenPrice(
  mode: "demo" | "live",
  pos: Position
): number | null {
  const priceBulk = netBreakEvenPriceBulk(mode, pos);
  if (priceBulk == null) return null;
  return priceBulk + bulkToChartShift(mode, pos);
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

/**
 * LIVE liquidation after adding `addSize` at `fillPrice` — an ESTIMATE of
 * where Bulk will report it, for the add preview.
 *
 * Bulk runs cross margin, so its liquidation price is not `entry ± entry/lev`
 * (that is the demo's isolated model): it is where the ACCOUNT's loss budget
 * runs out. That budget is read straight off Bulk's current numbers —
 * |entry − liq| × size — and is shared by the bigger position after the add,
 * less the add's entry fee. The added size also raises maintenance margin,
 * which Bulk does not expose per unit, so the real line lands a little CLOSER
 * to entry than this. Callers should present it as approximate.
 *
 * Returns null when Bulk has not reported a usable liquidation price.
 */
export function crossLiquidationAfterAdd(
  pos: Position,
  addSize: number,
  fillPrice: number
): number | null {
  if (!(pos.liquidationPrice > 0) || !(pos.size > 0)) return null;
  const dir = pos.direction === "long" ? 1 : -1;
  const newSize = pos.size + addSize;
  const newEntry = (pos.entryPrice * pos.size + fillPrice * addSize) / newSize;
  const lossBudget =
    Math.abs(pos.entryPrice - pos.liquidationPrice) * pos.size -
    fillPrice * addSize * fillFeeRate();
  if (lossBudget <= 0) return newEntry;
  const liq = newEntry - (dir * lossBudget) / newSize;
  return Number.isFinite(liq) && liq > 0 ? liq : null;
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
// A trailing stop sits in the PROFIT zone (between break-even and mark) and
// only ratchets in the profit direction — for a long it can only climb, for a
// short only fall. Its floor is the NET break-even (`trailReferencePrice`), so
// it can never lock a loss AFTER fees: worst case it exits at ~zero net. You
// can only arm it once price is more than `trailPct` past that floor, otherwise
// the stop would land at or below it (see canTrail).
//
// Live, the trail is Bulk's native `trl`: it starts `trailPct` behind the price
// it was armed at and only ratchets from there. So the arming gate IS the
// floor — a trail armed with its first stop above break-even can never exit
// below it.

/**
 * The trail's floor for a position: the NET break-even (all fees, paid and
 * exit, plus funding — see `netBreakEvenPriceBulk`) in the chart's price space.
 * Holding the trail here rather than at entry is what makes "never locks a
 * loss" true after fees; at entry a trail still closed down the fees.
 *
 * Demo charges no fees, so its break-even is entry and this falls back to it.
 *
 * It is in the CHART's price space — the space the live price ticks arrive in.
 *
 * WHY THIS EXISTS. The trail is driven by MagicBlock prices, but it used to
 * clamp against `position.entryPrice`, which Bulk quotes in its own feed's
 * space. Comparing the two mixed price spaces, so the clamp floor sat off by
 * the spread between the feeds:
 *
 *   - Bulk above MagicBlock → the floor sat too high; the trail refused to arm
 *     while genuinely in profit, and locked more than asked.
 *   - Bulk BELOW MagicBlock → the floor sat UNDER real break-even, so a trail
 *     could close at an actual loss. That directly violates this module's
 *     "clamped to entry so it can never lock a loss" guarantee.
 *
 * Using the same translation as the chart's entry line keeps the trail, the
 * line the user sees, and the price feed driving it all in one space.
 */
export function trailReferencePrice(
  mode: "demo" | "live",
  pos: Position
): number {
  return netBreakEvenPrice(mode, pos) ?? breakEvenPrice(mode, pos);
}

/**
 * A price the USER picked off the chart (MagicBlock space), expressed in the
 * space BULK will compare it against.
 *
 * This is what makes a take-profit fire where the user pointed. The chart's Y
 * axis is the MagicBlock oracle, so a level read off it — or typed to match a
 * number seen there — is a MagicBlock price. Bulk evaluates a resting trigger
 * against its OWN feed (`fairPrice`), and the two run persistently apart
 * (measured live 2026-09-18: BTC MagicBlock ~$38 BELOW Bulk, a steady 0.05%).
 * Sending the raw number therefore places the trigger ~$38 away from the level
 * the user meant — it fires early or late by that much, every time.
 *
 * Inverse of `bulkToChartSpace`.
 */
export function chartToBulkSpace(
  mode: "demo" | "live",
  pos: Position,
  chartPrice: number
): number {
  return chartPrice - bulkToChartShift(mode, pos);
}

/**
 * A Bulk-quoted price expressed in the chart's MagicBlock space.
 *
 * Used to show a RESTING trigger (which Bulk stores in its own space) at the
 * level it will actually appear to fire at on the chart.
 */
export function bulkToChartSpace(
  mode: "demo" | "live",
  pos: Position,
  bulkPrice: number
): number {
  return bulkPrice + bulkToChartShift(mode, pos);
}

/**
 * A trail stop (which lives in MagicBlock space) expressed in BULK's space.
 *
 * Only for surfaces that quote Bulk's numbers directly — the positions panel
 * lists Entry / Break-even / Liquidation straight from Bulk, so showing the
 * trail stop beside them untranslated would put one row in a different space
 * from its neighbours. The CHART needs no conversion: the stop is already
 * native to the space the chart draws in.
 */
export function trailStopInBulkSpace(
  mode: "demo" | "live",
  pos: Position
): number | null {
  if (pos.trailStopPrice == null) return null;
  if (mode === "demo") return pos.trailStopPrice;
  return pos.trailStopPrice - bulkToChartShift(mode, pos);
}

/**
 * Raw trail stop `trailPct` behind a reference price, then clamped to entry so
 * it never crosses into loss. Long: stop below price but ≥ entry. Short: stop
 * above price but ≤ entry.
 *
 * `entryPrice` here MUST be in the same price space as `refPrice` — for live
 * positions that means `trailReferencePrice(mode, pos)`, not the raw Bulk
 * `position.entryPrice`.
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
 *
 * `entryPrice` and `currentPrice` MUST share a price space — pass
 * `trailReferencePrice(mode, pos)` for live positions, since `currentPrice` is
 * a MagicBlock tick while Bulk's `entryPrice` is not.
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

// --- Account collateral (cross margin) ---------------------------------------
//
// Under cross margin there is ONE shared collateral pool. `equity` is the total,
// `marginUsed` is locked by open positions, `available` is free. "Margin health"
// = the fraction of equity that is NOT locked — a rough safety gauge (1 = all
// free, 0 = fully committed / near liquidation). Only the AVAILABLE portion can
// ever be withdrawn; the in-use portion belongs to open positions.

export interface MarginHealth {
  /** Fraction of equity that is free (0..1). Higher = safer. */
  ratio: number;
  /** Free collateral in USD (== balance.available). */
  available: number;
  /** Collateral locked by open positions in USD (== balance.marginUsed). */
  inUse: number;
  /**
   * Max USD safely withdrawable — the available balance minus a small buffer so
   * a withdraw can't leave open positions on the edge of liquidation.
   */
  maxWithdrawable: number;
}

/** Safety buffer kept back from withdrawals: 5% of equity, so pulling "all
 *  available" still leaves a cushion above the maintenance requirement. */
const WITHDRAW_BUFFER_FRAC = 0.05;

export function marginHealth(balance: Balance | null | undefined): MarginHealth {
  if (!balance || balance.equity <= 0) {
    return { ratio: 1, available: 0, inUse: 0, maxWithdrawable: 0 };
  }
  const available = Math.max(0, balance.available);
  const inUse = Math.max(0, balance.marginUsed);
  const ratio = Math.max(0, Math.min(1, available / balance.equity));
  const buffer = balance.equity * WITHDRAW_BUFFER_FRAC;
  const maxWithdrawable = Math.max(0, available - buffer);
  return { ratio, available, inUse, maxWithdrawable };
}
