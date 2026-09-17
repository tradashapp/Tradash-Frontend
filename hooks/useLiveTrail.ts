"use client";

import { useEffect } from "react";
import { useAppSelector } from "@/store/hooks";
import { tickProfit } from "@/lib/sound";

// Profit feedback for the ACTIVE market's live position.
//
// This hook used to ALSO run the trailing stop: a per-tick watcher that
// ratcheted the stop in the Redux store and fired a reduce-only close when
// price crossed it. That has been replaced by Bulk's native `trl` order (see
// lib/bulk/protection.ts), which rests server-side and keeps trailing with the
// app closed — the client watcher only trailed while a tab happened to be open,
// which is precisely when a stop loss is least needed.
//
// What remains is the sound: it is genuinely client-side, since it plays to
// whoever is watching.
export function useLiveProfitSound() {
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const positions = useAppSelector((s) => s.position.bySymbol);
  const activeSymbol = useAppSelector((s) => s.market.active);

  useEffect(() => {
    if (mode !== "live") return;
    const p = positions[activeSymbol];
    if (p) tickProfit(p.unrealizedPnl);
  }, [mode, positions, activeSymbol]);
}
