import { config } from "@/lib/config";
import { lotSizeForBulkSymbol } from "@/lib/markets";
import { submitSigned } from "./client";
import type { AgentSigner } from "./signing";
import type { BuilderCode, OrderResponse } from "./types";

// Build + submit market orders signed by the agent key (on behalf of the
// master). Uses the keychain's VERBOSE order format (symbol/isBuy/size/price/
// orderType), which it compiles to the compact { m: {...} } action + envelope.
// Our builder code rides on every order we route (revenue).

function builderCode(): BuilderCode | undefined {
  const { recipient, feeBps } = config.builder;
  if (!recipient || !feeBps) return undefined; // omit — null is rejected
  return { to: recipient, fee: feeBps };
}

/**
 * Does this error mean "the master never approved our builder code"?
 *
 * Bulk turns these away as `rejectedInvalid` with a reason like
 *   "builder-code fee 5bps not approved for <recipient>"
 * which `submitSigned` surfaces as `Bulk order error: <reason>`. Since Bulk
 * exposes no readable approval state (see builderStore.ts), this rejection is
 * the ONLY authoritative signal that our optimistic cache is wrong — callers
 * use it to clear the cache and re-run onboarding.
 */
export function isBuilderNotApprovedError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /builder-code fee .*not approved/i.test(msg);
}

/**
 * Does this error mean "the signature didn't verify"?
 *
 * Bulk answers `bad signature` for several unrelated causes and names none of
 * them, so it is one of the least actionable errors in the API. In practice it
 * is almost never a corrupt signature — it is a MISMATCH between what signed
 * and what the server expected:
 *
 *  - the agent key was authorized on a DIFFERENT NETWORK (the common one: the
 *    signature carries a domain byte, the server rebuilds the preimage with its
 *    own, and they disagree — see `signatureDomain()` in lib/config.ts);
 *  - the stored agent key was revoked, or belongs to another master account;
 *  - `NEXT_PUBLIC_BULK_NETWORK` doesn't match the network `restUrl` points at.
 *
 * All three are fixed the same way — re-run setup so a fresh agent is
 * authorized on the network actually in use — which is why they share one
 * message rather than being told apart.
 */
export function isBadSignatureError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /bad signature|unauthorized signer/i.test(msg);
}

/**
 * Floor a base-asset size to a whole multiple of the market's lot size.
 *
 * Bulk keeps sizes as FIXED-POINT: a size finer than `lotSize` is not
 * representable, and the API rejects the whole order with
 *   422 `actions[0].m.sz: f64 must be finite, positive, and within
 *        fixed-point range`
 * Floors (never rounds up) so a reduce-only close can't ask for more than the
 * position holds and flip into an open on the other side.
 *
 * Returns 0 when the size is below one lot — the caller must treat that as
 * "not submittable" rather than sending a zero-size order, which Bulk rejects
 * with the same 422 (`positive`).
 *
 * The division is done in lot units and re-rounded because binary floats make
 * e.g. 0.29 / 0.0001 land on 2899.9999999999995, which would silently shave a
 * lot off every order.
 */
export function floorToLot(size: number, lotSize: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (!Number.isFinite(lotSize) || lotSize <= 0) return 0;
  const lots = Math.floor(round(size / lotSize, 6));
  if (lots <= 0) return 0;
  return round(lots * lotSize, 12);
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Is this position size too small to ever be closed?
 *
 * A fill can settle a hair short of the requested size and strand a residue
 * below one lot (seen in production 2026-09-16: a SOL-USD position left at
 * 3e-9, five orders of magnitude under its 0.0001 lot). Such a residue cannot
 * be sent to /order at all, so it is dust: economically zero — 3e-9 SOL needs a
 * ~$3.3M price move to shift its PnL by one cent — and permanently unclosable.
 */
export function isDustSize(size: number, lotSize: number): boolean {
  return floorToLot(Math.abs(size), lotSize) === 0;
}

/** Convert a USD margin + leverage into base-asset size at the given price. */
export function baseSizeFromUsd(
  usdMargin: number,
  leverage: number,
  price: number
): number {
  if (price <= 0) return 0;
  return (usdMargin * leverage) / price;
}

// A market order still needs a price bound (worst acceptable fill). Give it
// generous slippage room so it always fills: buys accept up to +10%, sells down
// to −10% of the reference price.
function marketPriceBound(refPrice: number, isBuy: boolean): number {
  return isBuy ? refPrice * 1.1 : refPrice * 0.9;
}

interface OpenParams {
  bulkSymbol: string; // "BTC-USD"
  isLong: boolean;
  size: number; // base-asset size
  refPrice: number; // current price, for the slippage bound
  /**
   * Isolated-margin routing. Defaults FALSE: Tradash is cross-margin only.
   * Bulk exposes a single account-level margin pool (`marginUsed` /
   * `availableMargin`) with no per-position bucket, and books every position
   * cross regardless — live accounts come back with `"iso": false` on every
   * row. Kept as an override only so an isolated flow could opt in later.
   */
  isolated?: boolean;
}

/** Open (or add to) a market position. */
export async function openMarket(
  signer: AgentSigner,
  { bulkSymbol, isLong, size, refPrice, isolated = false }: OpenParams
): Promise<OrderResponse> {
  const bc = builderCode();
  const order = {
    type: "order",
    symbol: bulkSymbol,
    isBuy: isLong,
    size,
    price: marketPriceBound(refPrice, isLong),
    reduceOnly: false,
    isolated,
    orderType: { type: "market" },
    ...(bc ? { builderCode: bc } : {}),
  };
  return submitSigned(signer.signOrderFor(order));
}

interface ReduceParams {
  bulkSymbol: string;
  /** Direction of the EXISTING position; close/reduce sends the opposite side. */
  positionIsLong: boolean;
  size: number; // base-asset size to reduce
  refPrice: number;
  /** See OpenParams.isolated — cross margin (false) is the default. */
  isolated?: boolean;
}

/** Reduce or fully close a position (reduce-only, opposite side). */
export async function reduceMarket(
  signer: AgentSigner,
  { bulkSymbol, positionIsLong, size, refPrice, isolated = false }: ReduceParams
): Promise<OrderResponse> {
  const isBuy = !positionIsLong; // opposite side closes
  // A sub-lot size is unsubmittable: Bulk encodes sizes as fixed-point and
  // rejects the whole order with a 422 (`m.sz: f64 must be finite, positive,
  // and within fixed-point range`). Reject it here with a legible message
  // instead of a raw API error.
  //
  // NOTE: the size is deliberately NOT floored to the lot size. Bulk holds
  // positions at finer precision than it advertises for orders (seen live
  // 2026-09-16: a BTC-USD position of 0.00777051 = 7770.51 lots against a
  // 1e-6 lot), so flooring a FULL close would strand the remainder as exactly
  // the dust this guard exists to prevent. Pass the size through and let Bulk
  // settle it.
  if (isDustSize(size, lotSizeForBulkSymbol(bulkSymbol))) {
    throw new Error(
      `Position size ${size} is below the minimum tradable increment for ` +
        `${bulkSymbol} — it cannot be closed on Bulk.`
    );
  }
  const order = {
    type: "order",
    symbol: bulkSymbol,
    isBuy,
    size,
    price: marketPriceBound(refPrice, isBuy),
    reduceOnly: true,
    isolated,
    orderType: { type: "market" },
    // No builder fee on the closing side by default.
  };
  return submitSigned(signer.signOrderFor(order));
}
