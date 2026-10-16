import { BULK_TO_SYMBOL, MARKETS, roundToTick } from "@/lib/markets";
import { submitSigned } from "./client";
import { resolveBuilderCode } from "./feeArrangement";
import { floorToLot } from "./orders";
import { cancelOrder } from "./protection";
import type { AgentSigner } from "./signing";
import type { OrderResponse } from "./types";
import type { LimitOrder, MarketSymbol } from "@/types";

/**
 * Resting LIMIT entries on Bulk: open (or add to) a position at a chosen price
 * instead of at market.
 *
 * Same keychain shape the backend grid bot already runs on mainnet
 * (`orderType: { type: "limit", tif }`), with GTC so the order RESTS until
 * price reaches it. A GTC that already crosses the book fills at once as a
 * taker — a buy limit above the mark buys now, at the best ask — which is
 * standard limit behaviour, and still bounded by the limit price.
 *
 * Both numbers are quantised before signing. Bulk carries size AND price as
 * fixed-point in the signed preimage; an off-lot size or off-tick price is
 * snapped server-side, the rebuilt preimage no longer matches, and the order
 * fails as an opaque `bad signature` (see `floorToLot`).
 */

export type LimitResult =
  /** Resting on the book, waiting for price. */
  | { kind: "resting"; orderId: string | null }
  /** Crossed the book and (at least partly) filled on arrival. */
  | { kind: "filled"; orderId: string | null };

interface PlaceParams {
  symbol: MarketSymbol;
  isLong: boolean;
  /** Base-asset size; floored to the lot here. */
  size: number;
  /** Limit price in Bulk's space; rounded to the tick here. */
  price: number;
}

export async function placeLimit(
  signer: AgentSigner,
  { symbol, isLong, size, price }: PlaceParams
): Promise<LimitResult> {
  const market = MARKETS[symbol];
  const lotSize = floorToLot(size, market.lotSize);
  if (lotSize <= 0) {
    throw new Error(
      `Order size ${size} is below the minimum increment (${market.lotSize}) for ${market.bulkSymbol}.`
    );
  }
  const px = roundToTick(symbol, price);
  if (!(px > 0)) throw new Error("Enter a limit price.");
  const bc = await resolveBuilderCode();
  const order = {
    type: "order",
    symbol: market.bulkSymbol,
    isBuy: isLong,
    size: lotSize,
    price: px,
    reduceOnly: false,
    isolated: false,
    orderType: { type: "limit", tif: "GTC" },
    ...(bc ? { builderCode: bc } : {}),
  };
  const res: OrderResponse = await submitSigned(signer.signOrderFor(order));
  const status = res?.response?.data?.statuses?.[0] as
    | Record<string, { oid?: string } | undefined>
    | undefined;
  if (status?.resting) {
    return { kind: "resting", orderId: status.resting.oid ?? null };
  }
  const filled = status?.filled ?? status?.partiallyFilled ?? status?.working;
  return { kind: "filled", orderId: filled?.oid ?? null };
}

/** Cancel one resting limit order. Bulk acks a success as `cancelled`. */
export async function cancelLimit(
  signer: AgentSigner,
  symbol: MarketSymbol,
  orderId: string
): Promise<void> {
  await submitSigned(
    signer.signOrderFor(cancelOrder(MARKETS[symbol].bulkSymbol, orderId)),
    { accept: ["cancelled"] }
  );
}

/** One raw open-order row; /account wraps it as `{ openOrder: {...} }`. */
interface RawOpenOrder {
  orderId?: string;
  symbol?: string;
  price?: number;
  /** Remaining size, SIGNED: negative = sell. */
  size?: number;
  originalSize?: number;
  filledSize?: number;
  orderType?: string;
  reduceOnly?: boolean;
}

/**
 * Normalize Bulk's `openOrders` into the limit entries we show.
 *
 * Only `orderType: "limit"` rows: TP / SL / trailing ride on the position as
 * protection, and grid-bot `trigger` baskets are not the user's entries.
 * Markets we don't list are dropped — there is no chart to draw them on.
 */
export function readLimitOrders(raw: unknown): LimitOrder[] {
  if (!Array.isArray(raw)) return [];
  const out: LimitOrder[] = [];
  for (const item of raw) {
    const r = ((item as { openOrder?: RawOpenOrder })?.openOrder ??
      item) as RawOpenOrder;
    if (r?.orderType !== "limit" || !r.orderId || !r.symbol) continue;
    const symbol = BULK_TO_SYMBOL[r.symbol];
    const signed = r.size ?? r.originalSize ?? 0;
    if (!symbol || !(r.price && r.price > 0) || signed === 0) continue;
    out.push({
      orderId: r.orderId,
      symbol,
      direction: signed > 0 ? "long" : "short",
      price: r.price,
      size: Math.abs(signed),
      filledSize: Math.abs(r.filledSize ?? 0),
      reduceOnly: r.reduceOnly ?? false,
    });
  }
  return out;
}
