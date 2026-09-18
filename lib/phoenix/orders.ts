import { PHOENIX_API } from "./config";
import {
  assertDelegateSigned,
  signersOfRest,
  type RestInstruction,
} from "./signers";

/**
 * Build Phoenix order instructions over REST.
 *
 * NOTHING HERE SIGNS OR BROADCASTS. These functions return unsigned
 * instructions and assert that the signer set is correct; submission is a
 * later migration phase. Keeping build and submit apart is deliberate — it is
 * what lets the delegate path be verified without any funds at risk.
 *
 * A MARKET ORDER IS FIVE INSTRUCTIONS, not one (verified live 2026-09-18):
 *   realloc_trader · sync_parent_to_child · place_market_order ·
 *   transfer_collateral_child_to_parent · transfer_native_sol_from_child_to_parent
 * They must be submitted together, atomically, in one transaction. Only
 * `place_market_order` carries the trading authority; the rest are plumbing.
 *
 * FIELD NAMING IS INCONSISTENT AND UNVALIDATED. `positionAuthority`,
 * `feePayer` and `traderPdaIndex` are camelCase; `num_base_lots` is snake_case.
 * Unknown fields are dropped with a 200 and no warning, so every request goes
 * through `assertDelegateSigned` before it can be used.
 */

export interface BuildOrderParams {
  /** Owner wallet — the trader PDA derives from this. Never signs when delegated. */
  authority: string;
  /** Delegate (session key) that authorises the trade. */
  positionAuthority: string;
  /** Sponsor covering fees/rent, so the user needs no SOL. */
  feePayer?: string;
  /** Phoenix market symbol, e.g. "BTC" (not Bulk's "BTC-USD"). */
  symbol: string;
  side: "buy" | "sell";
  /** Size in BASE ASSET units. Below one lot Phoenix returns `ZeroBaseLots`. */
  quantity: number;
  traderPdaIndex?: number;
  traderSubaccountIndex?: number;
}

async function postIx(
  path: string,
  body: Record<string, unknown>
): Promise<RestInstruction[]> {
  const res = await fetch(`${PHOENIX_API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Phoenix reports real failures with real status codes and a useful body —
    // unlike Bulk, which returns 200 and hides the error in the payload.
    throw new Error(`Phoenix ${path} failed: ${res.status} — ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as RestInstruction[];
}

/**
 * Build an UNSIGNED market order and verify the delegate signs it.
 *
 * Throws if the owner appears in the signer set — see `signers.ts` for why that
 * check is not optional.
 */
export async function buildMarketOrder(
  p: BuildOrderParams
): Promise<RestInstruction[]> {
  const ixs = await postIx("/v1/ix/place-isolated-market-order", {
    authority: p.authority,
    positionAuthority: p.positionAuthority,
    ...(p.feePayer ? { feePayer: p.feePayer } : {}),
    symbol: p.symbol,
    side: p.side,
    quantity: p.quantity,
    traderPdaIndex: p.traderPdaIndex ?? 0,
    ...(p.traderSubaccountIndex != null
      ? { traderSubaccountIndex: p.traderSubaccountIndex }
      : {}),
  });

  assertDelegateSigned(signersOfRest(ixs), {
    delegate: p.positionAuthority,
    feePayer: p.feePayer,
    owner: p.authority,
  });

  return ixs;
}

export interface TriggerLeg {
  /** Side that CLOSES the position: "sell" for a long, "buy" for a short. */
  side: "buy" | "sell";
  triggerPrice: number;
  executionPrice: number;
  orderKind?: "ioc" | "limit";
}

export interface BuildProtectionParams
  extends Omit<BuildOrderParams, "side" | "quantity"> {
  /** Fires when price rises through the trigger — TP on a long, SL on a short. */
  greaterTrigger?: TriggerLeg | null;
  /** Fires when price falls through the trigger — SL on a long, TP on a short. */
  lessTrigger?: TriggerLeg | null;
  /** Percentage of the position to close. Defaults to the whole thing. */
  sizePercent?: number;
}

/**
 * Build an UNSIGNED TP/SL bracket against an existing position.
 *
 * Both legs travel in ONE instruction — cheaper and far simpler than Bulk,
 * where each trigger was a separate signed order followed by a read-back
 * verification loop (Bulk acks a malformed trigger with a real order id and
 * then discards it).
 *
 * WIRE FIELDS ARE `greaterTrigger` / `lessTrigger`. The SDK's on-chain type
 * calls them `greaterTriggerOrder` / `lessTriggerOrder`; using those names here
 * yields `400 "At least one trigger direction is required"`.
 */
export async function buildProtection(
  p: BuildProtectionParams
): Promise<RestInstruction[]> {
  if (!p.greaterTrigger && !p.lessTrigger) {
    throw new Error("buildProtection: at least one trigger leg is required");
  }

  const leg = (t: TriggerLeg) => ({
    side: t.side,
    orderKind: t.orderKind ?? "ioc",
    triggerPrice: t.triggerPrice,
    executionPrice: t.executionPrice,
  });

  const ixs = await postIx("/v1/ix/place-position-conditional-order", {
    authority: p.authority,
    positionAuthority: p.positionAuthority,
    ...(p.feePayer ? { feePayer: p.feePayer } : {}),
    symbol: p.symbol,
    traderPdaIndex: p.traderPdaIndex ?? 0,
    ...(p.greaterTrigger ? { greaterTrigger: leg(p.greaterTrigger) } : {}),
    ...(p.lessTrigger ? { lessTrigger: leg(p.lessTrigger) } : {}),
    sizePercent: p.sizePercent ?? 100,
  });

  assertDelegateSigned(signersOfRest(ixs), {
    delegate: p.positionAuthority,
    feePayer: p.feePayer,
    owner: p.authority,
  });

  return ixs;
}
