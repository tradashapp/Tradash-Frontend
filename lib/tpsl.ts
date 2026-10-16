import { unrealizedPnl } from "@/lib/perp";
import type { Direction, Position } from "@/types";

/**
 * Conversions between the three ways a user can express a TP/SL level and the
 * trigger price Bulk actually needs.
 *
 *   ROI %     — return on the MARGIN put up (what "+67%" means at 20× leverage)
 *   Change %  — move in the PRICE itself from entry (a 3.35% move on the asset)
 *   P&L       — the dollar profit or loss at the trigger
 *
 * All three describe the same point, so each mode converts to a trigger price
 * and back. Everything here is pure: prices in Bulk's space (matching the
 * Entry / Liquidation figures shown beside them), sizes in the base asset.
 *
 * Sign convention: a take-profit's ROI/P&L is usually POSITIVE and a
 * stop-loss's NEGATIVE, for both longs and shorts — though a stop moved to
 * break-even or beyond reads 0 or positive, which is allowed. Users enter
 * "-29%" for a stop the same way whichever direction they hold, and
 * `triggerFromRoi` puts the level on the correct side of entry from the
 * position's direction.
 */

/** The dollar P&L a position would realize if closed at `price`. */
export function pnlAtPrice(
  direction: Direction,
  size: number,
  entryPrice: number,
  price: number
): number {
  return unrealizedPnl(direction, size, entryPrice, price);
}

/** ROI on margin (as a percentage) if the position were closed at `price`. */
export function roiAtPrice(
  pos: Pick<Position, "direction" | "size" | "entryPrice" | "marginUsed">,
  price: number
): number {
  if (pos.marginUsed <= 0) return 0;
  const pnl = pnlAtPrice(pos.direction, pos.size, pos.entryPrice, price);
  return (pnl / pos.marginUsed) * 100;
}

/** Price change from entry (as a percentage) at `price`. */
export function changeAtPrice(entryPrice: number, price: number): number {
  if (entryPrice <= 0) return 0;
  return ((price - entryPrice) / entryPrice) * 100;
}

/**
 * Trigger price for a target ROI on margin.
 *
 * Derivation: pnl = roi% / 100 × margin, and pnl = ±(price − entry) × size, so
 * the price offset is pnl / size, applied in the profitable direction for a
 * long and the opposite for a short.
 */
export function triggerFromRoi(
  pos: Pick<Position, "direction" | "size" | "entryPrice" | "marginUsed">,
  roiPct: number
): number {
  if (pos.size <= 0) return pos.entryPrice;
  const targetPnl = (roiPct / 100) * pos.marginUsed;
  const offset = targetPnl / pos.size;
  return pos.direction === "long"
    ? pos.entryPrice + offset
    : pos.entryPrice - offset;
}

/**
 * Trigger price for a target price change from entry.
 *
 * Unlike ROI, this is signed in PRICE terms and direction-independent: +2%
 * means a price 2% above entry whether the user is long or short. The caller
 * decides whether that represents profit (it does for a long, not for a short).
 */
export function triggerFromChange(
  entryPrice: number,
  changePct: number
): number {
  return entryPrice * (1 + changePct / 100);
}

/** Trigger price for a target dollar P&L. */
export function triggerFromPnl(
  pos: Pick<Position, "direction" | "size" | "entryPrice">,
  pnl: number
): number {
  if (pos.size <= 0) return pos.entryPrice;
  const offset = pnl / pos.size;
  return pos.direction === "long"
    ? pos.entryPrice + offset
    : pos.entryPrice - offset;
}

export type TpSlSide = "tp" | "sl";

/**
 * Why a proposed trigger cannot be used, or null when it is fine.
 *
 * Returns a message meant to be shown verbatim.
 *
 * The side check is against the MARK, not entry. Bulk fires a long's stop when
 * price FALLS to it and its take-profit when price RISES to it — entry plays no
 * part — so the only level that can make a trigger invalid is one price has
 * already crossed. Checking against entry blocked the most common stop edit
 * there is: dragging a winning long's stop up to break-even or above, to lock
 * profit in. Likewise a take-profit below entry on a losing long is just an
 * exit on a bounce, not a mistake.
 *
 * The liquidation check matters most: a stop placed beyond the liquidation
 * price is not a stop at all, since the position would be liquidated before
 * the trigger was ever reached.
 */
export function validateTrigger({
  side,
  direction,
  entryPrice,
  markPrice,
  liquidationPrice,
  triggerPrice,
}: {
  side: TpSlSide;
  direction: Direction;
  entryPrice: number;
  markPrice: number | undefined;
  liquidationPrice: number;
  triggerPrice: number;
}): string | null {
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) {
    return "Enter a trigger price.";
  }

  const long = direction === "long";
  // Without a live mark, entry is the best stand-in for "where price is now".
  const ref = markPrice != null && markPrice > 0 ? markPrice : entryPrice;
  const firesAbove = side === "tp" ? long : !long;

  // A level price has already crossed would fire the instant it rests.
  if (firesAbove ? ref >= triggerPrice : ref <= triggerPrice) {
    return `${side === "tp" ? "Take profit" : "Stop loss"} must be ${
      firesAbove ? "above" : "below"
    } the mark price.`;
  }

  if (side === "sl" && liquidationPrice > 0) {
    const beyond = long
      ? triggerPrice <= liquidationPrice
      : triggerPrice >= liquidationPrice;
    // Bulk's liquidation starts by CANCELLING every resting order on the
    // account (docs: Liquidations → Step 1), so a stop past this line is not
    // late — it is deleted before price ever reaches it.
    if (beyond) {
      return `Stop loss must be ${
        long ? "above" : "below"
      } your liquidation price — liquidation cancels it first. Use less size or leverage to widen the gap.`;
    }
  }

  return null;
}
