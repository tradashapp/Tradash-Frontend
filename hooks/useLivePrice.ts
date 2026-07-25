"use client";

import { useEffect, useRef } from "react";
import { subscribeToPrice } from "@/lib/oracle/magicblock";
import { commitPrice } from "@/store/slices/priceSlice";
import { useAppDispatch } from "@/store/hooks";
import type { MarketSymbol } from "@/types";

// Commit at most this often to Redux. The raw feed (50-200ms) drives the chart
// directly via onTick; Redux only needs a live-but-not-thrashing sampled value
// for connected UI like the price header.
const COMMIT_INTERVAL_MS = 200;

/**
 * Subscribes to the oracle for `symbol`. Every tick is handed to `onTick`
 * (for the chart engine's interpolator) and, at most every COMMIT_INTERVAL_MS,
 * committed into the Redux price slice.
 */
export function useLivePrice(
  symbol: MarketSymbol,
  onTick: (price: number) => void
) {
  const dispatch = useAppDispatch();
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const lastCommit = useRef(0);
  const latest = useRef<number | null>(null);

  useEffect(() => {
    lastCommit.current = 0;
    latest.current = null;

    const unsub = subscribeToPrice(symbol, (price) => {
      latest.current = price;
      onTickRef.current(price);

      const now = performance.now();
      if (now - lastCommit.current >= COMMIT_INTERVAL_MS) {
        lastCommit.current = now;
        dispatch(commitPrice({ symbol, price, at: Date.now() }));
      }
    });

    return unsub;
  }, [symbol, dispatch]);
}
