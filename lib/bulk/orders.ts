import { lotSizeForBulkSymbol } from "@/lib/markets";
import { submitSigned } from "./client";
import { resolveBuilderCode } from "./feeArrangement";
import type { AgentSigner } from "./signing";
import type { OrderResponse } from "./types";

// Build + submit market orders signed by the agent key (on behalf of the
// master). Uses the keychain's VERBOSE order format (symbol/isBuy/size/price/
// orderType), which it compiles to the compact { m: {...} } action + envelope.
// Our builder code rides on every opening order we route (revenue), at the
// per-user rate the backend serves (see feeArrangement.ts).

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
 * them, so it is one of the least actionable errors in the API. It is almost
 * never a corrupt signature — it is a MISMATCH between the key that signed and
 * the key the server expected to sign.
 *
 * VERIFIED live 2026-09-21 against mainnet-api1.bulk.trade, because the first
 * guess here was wrong. The two messages are NOT interchangeable:
 *
 *  - `unauthorized signer` — the signing pubkey is not on the account's
 *    `authorizedAgentWallets`. Returned for a key the account has never seen,
 *    under EVERY signature domain (mainnet/testnet/devnet all answered this for
 *    a throwaway key), so the domain is NOT what distinguishes them.
 *  - `bad signature` — the signer IS authorized, but the signature does not
 *    verify. **This is usually NOT a key problem**, and re-running setup does
 *    not fix it. Causes, in the order they have actually occurred:
 *
 *      1. **A stale `bulk-keychain-wasm`.** The package defines the signing
 *         preimage; 0.1.28 added a `"bulk-actions"` domain-separation prefix
 *         that 0.1.26 lacked. Mainnet moved to the new format, so every order
 *         signed by the old package was rejected — with an unchanged API, so
 *         nothing failed to compile. THIS WAS THE REAL ONE. See keychain.ts.
 *      2. `NEXT_PUBLIC_BULK_NETWORK` disagreeing with the network `restUrl`
 *         points at — the domain byte is part of the preimage.
 *      3. The stored secret not matching the stored pubkey (see the rehydrate
 *         guard in useAgentWallet), or a revoked key. Rare, and the only one
 *         setup can fix.
 *
 * Because (1) and (2) are configuration rather than credentials, the order path
 * deliberately does NOT route this to the setup flow — that loop re-issues keys
 * forever while the real fault sits in the client build.
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

/**
 * Open (or add to) a market position.
 *
 * THE SIZE MUST BE FLOORED TO THE MARKET'S LOT before it is signed. This is not
 * tidiness — it is the difference between an order filling and an opaque
 * `bad signature`.
 *
 * Sizes travel in the SIGNED PREIMAGE as a fixed-point integer (1e8 units),
 * not as the float in the JSON. A size that is not a whole number of lots is
 * re-quantised by the server, which then rebuilds the preimage from the snapped
 * value — and that no longer matches what the client signed. Bulk reports the
 * mismatch as `bad signature`, naming neither the size nor the rounding, which
 * is why this looked for a long time like a key or network problem.
 *
 * Verified 2026-09-21 from a real failing envelope: 0.4265022573941039 SOL
 * encodes to 42650226 fixed-point units, which is not a multiple of SOL's
 * 10000-unit (0.0001) lot — remainder 226. Flooring to 0.4265 gives 42650000,
 * an exact multiple.
 *
 * `baseSizeFromUsd` produces such a size on nearly every order (margin ÷ a live
 * price is an arbitrary float), so this affects all markets, not just SOL.
 */
export async function openMarket(
  signer: AgentSigner,
  { bulkSymbol, isLong, size, refPrice, isolated = false }: OpenParams
): Promise<OrderResponse> {
  const lot = lotSizeForBulkSymbol(bulkSymbol);
  const lotSize = floorToLot(size, lot);
  if (lotSize <= 0) {
    // Below one lot there is no representable order. Say so here rather than
    // sending a zero size for Bulk to reject with a fixed-point 422.
    throw new Error(
      `Order size ${size} is below the minimum increment (${lot}) for ${bulkSymbol}.`
    );
  }
  const bc = await resolveBuilderCode();
  const order = {
    type: "order",
    symbol: bulkSymbol,
    isBuy: isLong,
    size: lotSize,
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
