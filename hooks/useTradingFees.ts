"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useAppSelector } from "@/store/hooks";
import { BULK_TAKER_FEE_BPS } from "@/lib/perp";
import {
  currentBuilderFeeBps,
  currentFeeCode,
  refreshFeeArrangement,
  subscribeFeeArrangement,
} from "@/lib/bulk/feeArrangement";

/**
 * The fees the NEXT order pays to open, in bps of trade size: Bulk's exchange
 * (taker) fee plus THIS user's Tradash fee — the server-issued rate, so a
 * discount code shows as the discounted rate rather than the general one.
 * Demo charges nothing.
 *
 * Closing pays Bulk's fee again but no Tradash fee (closes carry no builder
 * code), which the explanations say.
 */
export interface TradingFees {
  demo: boolean;
  bulkBps: number;
  tradashBps: number;
  /** bulkBps + tradashBps. */
  totalBps: number;
  /** The fee code lowering the Tradash fee, if any. */
  code: string | null;
}

export function useTradingFees(): TradingFees {
  const demo = useAppSelector((s) => s.tradingMode.mode) === "demo";
  const tradashBps = useSyncExternalStore(subscribeFeeArrangement, currentBuilderFeeBps, currentBuilderFeeBps);
  const code = useSyncExternalStore(subscribeFeeArrangement, currentFeeCode, () => null);

  // A code redeemed on another device, or a changed default, shows up the next
  // time a fee is on screen (the module dedupes concurrent reads).
  useEffect(() => {
    if (!demo) void refreshFeeArrangement();
  }, [demo]);

  if (demo) return { demo, bulkBps: 0, tradashBps: 0, totalBps: 0, code: null };
  return { demo, bulkBps: BULK_TAKER_FEE_BPS, tradashBps, totalBps: BULK_TAKER_FEE_BPS + tradashBps, code };
}

/** 3.5 bps → "0.035%". */
export const bpsAsPct = (bps: number) =>
  `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
