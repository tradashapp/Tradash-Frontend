import { config } from "@/lib/config";
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
  isolated?: boolean;
}

/** Open (or add to) a market position. */
export async function openMarket(
  signer: AgentSigner,
  { bulkSymbol, isLong, size, refPrice, isolated = true }: OpenParams
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
  isolated?: boolean;
}

/** Reduce or fully close a position (reduce-only, opposite side). */
export async function reduceMarket(
  signer: AgentSigner,
  { bulkSymbol, positionIsLong, size, refPrice, isolated = true }: ReduceParams
): Promise<OrderResponse> {
  const isBuy = !positionIsLong; // opposite side closes
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
