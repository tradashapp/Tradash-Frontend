import { config } from "@/lib/config";
import { submitSigned } from "./client";
import type { AgentSigner } from "./signing";
import type { BuilderCode, MarketOrderAction, OrderResponse } from "./types";

// Build + submit market orders signed by the agent key. Our builder code is
// attached to every order we route (revenue), omitted only if unconfigured.

function builderCode(): BuilderCode | undefined {
  const { recipient, feeBps } = config.builder;
  if (!recipient || !feeBps) return undefined; // omit — null is rejected
  return { to: recipient, fee: feeBps };
}

/** Convert a USD notional + leverage into base-asset size at the given price. */
export function baseSizeFromUsd(
  usdMargin: number,
  leverage: number,
  price: number
): number {
  if (price <= 0) return 0;
  return (usdMargin * leverage) / price;
}

interface OpenParams {
  bulkSymbol: string; // "BTC-USD"
  isLong: boolean;
  size: number; // base-asset size
  isolated?: boolean;
}

/** Open (or add to) a market position. */
export async function openMarket(
  signer: AgentSigner,
  { bulkSymbol, isLong, size, isolated = true }: OpenParams
): Promise<OrderResponse> {
  const action: MarketOrderAction = {
    m: {
      c: bulkSymbol,
      b: isLong,
      sz: size,
      r: false,
      i: isolated,
      ...(builderCode() ? { builderCode: builderCode() } : {}),
    },
  };
  const signed = signer.signOrder(action);
  return submitSigned(signed);
}

interface ReduceParams {
  bulkSymbol: string;
  /** Direction of the EXISTING position; close/reduce sends the opposite side. */
  positionIsLong: boolean;
  size: number; // base-asset size to reduce
  isolated?: boolean;
}

/** Reduce or fully close a position (reduce-only, opposite side). */
export async function reduceMarket(
  signer: AgentSigner,
  { bulkSymbol, positionIsLong, size, isolated = true }: ReduceParams
): Promise<OrderResponse> {
  const action: MarketOrderAction = {
    m: {
      c: bulkSymbol,
      b: !positionIsLong, // opposite side
      sz: size,
      r: true, // reduce-only
      i: isolated,
      // No builder fee on the closing side by default.
    },
  };
  const signed = signer.signOrder(action);
  return submitSigned(signed);
}
