"use client";

import { useEffect, useRef } from "react";
import { subscribeToPrice } from "@/lib/oracle/magicblock";
import type { MarketSymbol } from "@/types";

/**
 * Subscribes to the oracle for `symbol` and feeds every tick to `onTick` (the
 * chart engine's interpolator) for 60fps rendering. Redux commits for all
 * markets are handled by useAllPrices, so this hook is chart-only.
 */
export function useLivePrice(
  symbol: MarketSymbol,
  onTick: (price: number) => void
) {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    const unsub = subscribeToPrice(symbol, (price) => {
      onTickRef.current(price);
    });
    return unsub;
  }, [symbol]);
}
