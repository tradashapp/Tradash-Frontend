import { PHOENIX_API } from "./config";
import type { RestInstruction } from "./signers";

/**
 * Reading and cancelling Phoenix conditional orders (TP / SL).
 *
 * HOW PHOENIX MODELS PROTECTION, and why it differs from Bulk.
 *
 * Bulk rests each trigger as its own order with an `orderId`, so cancelling
 * meant listing orders and cancelling each id. Phoenix instead attaches ONE
 * conditional order to a position, carrying up to two legs:
 *
 *   greaterTrigger → fires when price rises through it  ("greater_than")
 *   lessTrigger    → fires when price falls through it  ("less_than")
 *
 * For a long that is TP above / SL below; for a short it is inverted. Cancelling
 * therefore addresses a LEG — `{conditionalOrderIndex, executionDirection}` —
 * not an order id. There is no id to carry over from the Bulk model, which is
 * why the domain `ProtectionOrder.orderId` cannot drive this.
 *
 * `conditionalOrderIndex` IS 1-BASED: the API rejects 0 outright with
 * "conditionalOrderIndex must be greater than zero" (verified live 2026-09-19).
 */

/** Which side of the trigger pair to cancel. */
export type ExecutionDirection = "greater_than" | "less_than";

export interface CancelLegParams {
  authority: string;
  positionAuthority: string;
  feePayer?: string;
  /** Phoenix symbol, e.g. "SOL". */
  symbol: string;
  /** 1-based. Index 0 is rejected by the API. */
  conditionalOrderIndex: number;
  executionDirection: ExecutionDirection;
  traderPdaIndex?: number;
}

/**
 * Distinguishes "there was nothing to cancel" from a real failure.
 *
 * The API answers a cancel for a leg that does not exist with
 * `404 Conditional order N (GreaterThan) not found`. For `cancelAllProtection`
 * that is the SUCCESS case — the goal is "no triggers left resting", and
 * already-gone satisfies it. Treating it as an error would make every close
 * report a spurious failure.
 */
export class NoSuchConditionalOrder extends Error {}

/**
 * Build the instructions to cancel ONE trigger leg.
 *
 * Throws `NoSuchConditionalOrder` when that leg is not resting.
 */
export async function buildCancelLeg(
  p: CancelLegParams
): Promise<RestInstruction[]> {
  const res = await fetch(`${PHOENIX_API}/v1/ix/cancel-conditional-order`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      authority: p.authority,
      positionAuthority: p.positionAuthority,
      ...(p.feePayer ? { feePayer: p.feePayer } : {}),
      symbol: p.symbol,
      traderPdaIndex: p.traderPdaIndex ?? 0,
      conditionalOrderIndex: p.conditionalOrderIndex,
      executionDirection: p.executionDirection,
    }),
  });
  const text = await res.text();

  if (res.status === 404 && /not found/i.test(text)) {
    throw new NoSuchConditionalOrder(
      `no ${p.executionDirection} leg at index ${p.conditionalOrderIndex} for ${p.symbol}`
    );
  }
  if (!res.ok) {
    throw new Error(
      `Phoenix cancel-conditional-order failed: ${res.status} — ${text.slice(0, 200)}`
    );
  }
  return JSON.parse(text) as RestInstruction[];
}

/**
 * How many conditional-order slots to sweep when clearing a position.
 *
 * Tradash arms at most one conditional order per position (a TP/SL pair), so in
 * practice only index 1 is ever occupied. A small sweep costs a few cheap 404s
 * and covers a position that accumulated more than one — for instance from a
 * user who also traded on Phoenix's own UI, which this app cannot see.
 */
export const CONDITIONAL_SWEEP_DEPTH = 4;

/** Both legs of a conditional order, in the order they are swept. */
export const BOTH_DIRECTIONS: ExecutionDirection[] = [
  "greater_than",
  "less_than",
];
