import { submitSigned } from "./client";
import type { AgentSigner } from "./signing";
import type { OrderResponse } from "./types";
import type { Direction, ProtectionOrder } from "@/types";

/**
 * Protective trigger orders (take-profit / stop-loss / trailing stop) that rest
 * on BULK and fire server-side — whether or not the app is open.
 *
 * This replaces the client-side watcher that `useLiveTrail` used to run: a
 * trailing stop that only trailed while a tab happened to be open was a stop
 * loss in name only.
 *
 * ── THE ONE RULE THAT MATTERS ────────────────────────────────────────────────
 * On tp/st, `isBuy` is NOT the side of the closing order — Bulk derives that
 * from the position itself. `isBuy` is the DIRECTION price must cross:
 *
 *     isBuy: true  → trigger.isAbove: true  → fires when price RISES to it
 *     isBuy: false → trigger.isAbove: false → fires when price FALLS to it
 *
 * So a position's TP and SL take OPPOSITE values:
 *
 *     LONG:  TP fires above (isBuy true),  SL fires below (isBuy false)
 *     SHORT: TP fires below (isBuy false), SL fires above (isBuy true)
 *
 * Get it wrong and Bulk answers `{"resting":{"oid":...}}` with a real order id
 * and then SILENTLY DISCARDS the order — nothing in openOrders, nothing in
 * protection.orders, no fill, no error, and a position the user believes is
 * protected. That is why `placeProtection` verifies against a read-back instead
 * of trusting the ack (verified live 2026-09-17).
 *
 * `trl` is INVERTED relative to tp/st: there `isBuy` IS the closing side, so a
 * long's trailing stop is `isBuy: true` and yields `isAbove: false`. Hence the
 * separate helper rather than one shared flag.
 */

/** Does this position's take-profit fire on a rise? (Its stop is the opposite.) */
function tpFiresAbove(direction: Direction): boolean {
  return direction === "long";
}

interface TpSlParams {
  bulkSymbol: string;
  /** Direction of the EXISTING position being protected. */
  direction: Direction;
  /** Base-asset size to close when it fires (normally the full position). */
  size: number;
  /** Trigger level, in Bulk's price space. */
  triggerPrice: number;
}

/**
 * Build the keychain order for a take-profit.
 *
 * `reduceOnly` is deliberately omitted: Bulk drops it from the tp/st wire
 * payload and infers it (read-back always shows `reduceOnly: true`). Passing it
 * produces byte-identical output, so including it would only imply a guarantee
 * the wire does not carry — size the order to the position instead.
 */
export function takeProfitOrder({
  bulkSymbol,
  direction,
  size,
  triggerPrice,
}: TpSlParams) {
  return {
    type: "takeProfit",
    symbol: bulkSymbol,
    isBuy: tpFiresAbove(direction),
    size,
    triggerPrice,
  };
}

/** Build the keychain order for a stop-loss (fires opposite the take-profit). */
export function stopLossOrder({
  bulkSymbol,
  direction,
  size,
  triggerPrice,
}: TpSlParams) {
  return {
    type: "stop",
    symbol: bulkSymbol,
    isBuy: !tpFiresAbove(direction),
    size,
    triggerPrice,
  };
}

interface TrailParams {
  bulkSymbol: string;
  direction: Direction;
  size: number;
  /** Trail distance behind the high-water mark, in basis points (100 = 1%). */
  trailBps: number;
  /** How far price must move before the stop ratchets, in basis points. */
  stepBps: number;
}

/**
 * Build the keychain order for a native trailing stop.
 *
 * NOTE the inversion: unlike tp/st, `trl`'s `isBuy` is the CLOSING side, so a
 * long trails with `isBuy: true` (which Bulk stores as `isAbove: false` — a
 * stop sitting below price). Verified live: a long's trail rests at
 * highWater × (1 − trailBps/10000) and ratchets up only.
 */
export function trailingStopOrder({
  bulkSymbol,
  direction,
  size,
  trailBps,
  stepBps,
}: TrailParams) {
  return {
    type: "trl",
    symbol: bulkSymbol,
    isBuy: direction === "long",
    size,
    trailBps,
    stepBps,
  };
}

/** Build the keychain order that cancels a resting trigger by its id. */
export function cancelOrder(bulkSymbol: string, orderId: string) {
  return { type: "cancel", symbol: bulkSymbol, orderId };
}

/**
 * Submit a signed protective order and return the resting order id.
 *
 * The id alone is NOT proof the order exists — see the module header. Callers
 * that need certainty should re-read the account and confirm the order appears
 * in `protection.orders`; `useProtection` does exactly that.
 */
export async function submitProtection(
  signer: AgentSigner,
  order: unknown
): Promise<string | null> {
  const res: OrderResponse = await submitSigned(signer.signOrderFor(order));
  const status = res?.response?.data?.statuses?.[0] as
    | { resting?: { oid?: string } }
    | undefined;
  return status?.resting?.oid ?? null;
}

/** Cancel one resting trigger order. */
export async function cancelProtection(
  signer: AgentSigner,
  bulkSymbol: string,
  orderId: string
): Promise<void> {
  await submitSigned(signer.signOrderFor(cancelOrder(bulkSymbol, orderId)));
}

/**
 * Cancel every protective trigger a position is carrying.
 *
 * Bulk keeps these resting after the position they guard is closed (verified
 * live 2026-09-17: a flat account still listed its old TP and SL at the
 * original sizes). A leftover trigger is not harmless — it is sized to a
 * position that no longer exists, so it would fire against the user's NEXT
 * position in that market, or open one on its own. Every exit path therefore
 * clears them.
 *
 * Cancels are independent: one failing must not strand the rest, so they settle
 * individually and the caller is told only whether all of them made it.
 */
export async function cancelAllProtection(
  signer: AgentSigner,
  bulkSymbol: string,
  orders: ProtectionOrder[] | undefined
): Promise<boolean> {
  if (!orders || orders.length === 0) return true;
  const results = await Promise.allSettled(
    orders.map((o) => cancelProtection(signer, bulkSymbol, o.orderId))
  );
  return results.every((r) => r.status === "fulfilled");
}

// --- Read-back ---------------------------------------------------------------

/** One raw `protection.orders[]` row as Bulk sends it. */
interface RawProtectionOrder {
  orderId?: string;
  orderType?: string;
  trigger?: {
    px?: number;
    isAbove?: boolean;
    pxHi?: number;
    trb?: number;
    stb?: number;
  };
}

/**
 * Normalize Bulk's `positions[].protection.orders[]` into ProtectionOrder[].
 *
 * Unknown order types are dropped rather than guessed at: showing a level we
 * cannot classify as a TP or an SL would be worse than showing none.
 */
export function readProtection(raw: unknown): ProtectionOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: ProtectionOrder[] = [];
  for (const r of raw as RawProtectionOrder[]) {
    const px = r?.trigger?.px;
    if (!r?.orderId || px == null) continue;
    const kind =
      r.orderType === "takeProfit"
        ? "takeProfit"
        : r.orderType === "stop"
          ? "stop"
          : r.orderType === "trailing"
            ? "trailing"
            : null;
    if (!kind) continue;
    out.push({
      orderId: r.orderId,
      kind,
      triggerPrice: px,
      isAbove: r.trigger?.isAbove ?? false,
      ...(r.trigger?.trb != null ? { trailBps: r.trigger.trb } : {}),
      ...(r.trigger?.pxHi != null ? { highWaterPrice: r.trigger.pxHi } : {}),
    });
  }
  return out;
}

/** The resting take-profit for a position, if any. */
export function findTakeProfit(
  orders: ProtectionOrder[] | undefined
): ProtectionOrder | null {
  return orders?.find((o) => o.kind === "takeProfit") ?? null;
}

/**
 * The resting FIXED stop-loss, if any.
 *
 * Deliberately excludes a trailing stop. Bulk rests a fixed stop and a trailing
 * stop side by side quite happily (verified live 2026-09-18: takeProfit +
 * trailing + stop all resting on one position), and they are different
 * promises — a fixed floor versus a ratcheting one. Conflating them would let
 * the UI silently cancel a trail the user never touched.
 */
export function findStopLoss(
  orders: ProtectionOrder[] | undefined
): ProtectionOrder | null {
  return orders?.find((o) => o.kind === "stop") ?? null;
}

/** The resting trailing stop, if any. Independent of `findStopLoss`. */
export function findTrailingStop(
  orders: ProtectionOrder[] | undefined
): ProtectionOrder | null {
  return orders?.find((o) => o.kind === "trailing") ?? null;
}

/**
 * The level that actually protects the downside right now: the trailing stop
 * when it sits tighter than the fixed stop, else the fixed stop.
 *
 * Both can rest at once and EITHER can fire first, so "the stop" for display
 * purposes is whichever price is reached sooner — for a long the higher of the
 * two, for a short the lower.
 */
export function effectiveStop(
  orders: ProtectionOrder[] | undefined,
  direction: Direction
): ProtectionOrder | null {
  const fixed = findStopLoss(orders);
  const trail = findTrailingStop(orders);
  if (!fixed) return trail;
  if (!trail) return fixed;
  return direction === "long"
    ? trail.triggerPrice >= fixed.triggerPrice
      ? trail
      : fixed
    : trail.triggerPrice <= fixed.triggerPrice
      ? trail
      : fixed;
}
