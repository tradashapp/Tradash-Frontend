"use client";

import { useEffect, useRef } from "react";
import { subscribeToPrice } from "@/lib/oracle";
import type { MarketSymbol } from "@/types";

/**
 * Subscribes to the oracle for `symbol` and feeds every tick to `onTick` (the
 * chart engine's interpolator) for 60fps rendering. Redux commits for all
 * markets are handled by useAllPrices, so this hook is chart-only.
 *
 * Pass `null` to skip the subscription entirely — used by charts driven from a
 * source other than the oracle (e.g. the landing-page simulated feed).
 */
export function useLivePrice(
  symbol: MarketSymbol | null,
  onTick: (price: number) => void
) {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (symbol == null) return;
    const unsub = subscribeToPrice(symbol, (price) => {
      onTickRef.current(price);
    });
    return unsub;
  }, [symbol]);
}
