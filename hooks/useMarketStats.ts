"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeHotMarkets,
  fetchAllMarketStats,
  type MarketStats,
} from "@/lib/bulk/marketStats";
import type { MarketSymbol } from "@/types";

// 24h stats are slow-moving, so a long refresh is plenty — and it keeps the
// Hot list stable rather than reshuffling under the user's finger.
const REFRESH_MS = 60_000;

/**
 * Loads Bulk's 24h market stats and derives the Hot set.
 *
 * Only fetches while `active` (the market sheet being open), so a closed sheet
 * costs nothing. Stats persist across open/close within a session.
 */
export function useMarketStats(active: boolean) {
  const [stats, setStats] = useState<
    Partial<Record<MarketSymbol, MarketStats>>
  >({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const load = async () => {
      const next = await fetchAllMarketStats();
      if (cancelled) return;
      // A wholly failed sweep returns {}; keep the previous values rather than
      // blanking the list (and the Hot pill) on one bad refresh.
      if (Object.keys(next).length > 0) setStats(next);
      setLoaded(true);
    };

    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  const hot = useMemo(() => computeHotMarkets(stats), [stats]);

  return { stats, hot, loaded };
}
