import type { Direction, ProtectionOrder } from "@/types";

/**
 * Reading protective triggers off a position.
 *
 * VENUE-NEUTRAL BY CONSTRUCTION: every function here is a pure query over the
 * domain `ProtectionOrder[]`, with no venue call and no wire format. They lived
 * in `lib/bulk/protection.ts` because that is where Bulk's parsing happens, but
 * nothing about them is Bulk-specific — three React components imported them
 * from there, which made the UI look coupled to a venue it does not care about.
 *
 * Parsing a venue's own wire format into `ProtectionOrder[]` stays with that
 * venue (`lib/bulk/protection.ts#readProtection`).
 */

/** The resting take-profit for a position, if any. */
export function findTakeProfit(
  orders: ProtectionOrder[] | undefined
): ProtectionOrder | null {
  return orders?.find((o) => o.kind === "takeProfit") ?? null;
}

/**
 * The resting FIXED stop-loss, if any.
 *
 * Deliberately excludes a trailing stop. A fixed stop and a trailing stop can
 * rest side by side (verified live on Bulk 2026-09-18: takeProfit + trailing +
 * stop all on one position), and they are different promises — a fixed floor
 * versus a ratcheting one. Conflating them would let the UI silently cancel a
 * trail the user never touched.
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
