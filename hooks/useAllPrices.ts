"use client";

import { useEffect, useRef } from "react";
import { subscribeToPrice } from "@/lib/oracle/magicblock";
import { commitPrice } from "@/store/slices/priceSlice";
import { useAppDispatch } from "@/store/hooks";
import { MARKET_ORDER } from "@/lib/markets";

// Commit cadence per market into Redux (the chart reads the raw feed directly;
// Redux just needs a live-but-not-thrashing value for connected UI).
const COMMIT_INTERVAL_MS = 200;

// Subscribes to EVERY market's oracle price in the background and commits it to
// the price slice. This keeps a live price for all markets — so the market
// switcher shows each one's price, and positions on non-active markets get
// correct PnL/liquidation. The active chart still drives its own 60fps rendering
// via CanvasChart's useLivePrice; this is purely for the store-backed values.
export function useAllPrices() {
  const dispatch = useAppDispatch();
  const lastCommit = useRef<Record<string, number>>({});

  useEffect(() => {
    const unsubs = MARKET_ORDER.map((symbol) =>
      subscribeToPrice(symbol, (price) => {
        const now = performance.now();
        if ((now - (lastCommit.current[symbol] ?? 0)) >= COMMIT_INTERVAL_MS) {
          lastCommit.current[symbol] = now;
          dispatch(commitPrice({ symbol, price, at: Date.now() }));
        }
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [dispatch]);
}
