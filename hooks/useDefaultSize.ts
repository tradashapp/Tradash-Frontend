"use client";

import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { defaultSizeFor, minSizeFor } from "@/lib/markets";

/**
 * Keeps `defaultPositionSize` at the right default for the active market.
 *
 * The default is the larger of:
 *   - the market's MINIMUM margin — Bulk rejects any order under $50 notional,
 *     so at BTC's 40× cap that floor is $1.25 of margin, at 25× it is $2, and
 *     at 10× it is $5 (plus a small pad, see `minSizeFor`); and
 *   - 5% of the balance available to trade.
 *
 * It is recomputed as the market changes and as the balance moves, because both
 * inputs move: switching from a 10× market to BTC should not leave a $5 size
 * sitting there, and depositing should not leave the size at the minimum.
 *
 * ONCE THE USER SETS A SIZE BY HAND this stops entirely
 * (`positionSizeTouched`). An explicit choice is a decision, and a balance tick
 * a second later must not quietly undo it.
 *
 * The one thing it still does for a touched size is raise it to the market's
 * minimum: a hand-picked $2 is a valid ETH order but an unfillable one on a 10×
 * market, and shipping it to Bulk only earns a rejection. Lowering a touched
 * size is never done — that would be overriding the user, not protecting them.
 */
export function useDefaultSize() {
  const dispatch = useAppDispatch();
  const symbol = useAppSelector((s) => s.market.active);
  const touched = useAppSelector((s) => s.settings.positionSizeTouched);
  const size = useAppSelector((s) => s.settings.defaultPositionSize);
  const byMarket = useAppSelector((s) => s.settings.leverageByMarket);
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const liveAvailable = useAppSelector((s) => s.user.balance?.available);
  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);

  // The same balance the settings sheet sizes against: demo keeps no margin
  // breakdown, so its realized balance stands in for "what you could post".
  const available = mode === "demo" ? demoBalance : liveAvailable ?? null;

  useEffect(() => {
    if (touched) {
      // Only ever raise a hand-picked size, and only to the point where the
      // order stops being rejected outright.
      const min = minSizeFor(symbol, byMarket);
      if (size < min) {
        dispatch(updateSettings({ defaultPositionSize: min }));
      }
      return;
    }

    const next = defaultSizeFor(symbol, available ?? null, byMarket);
    // Guard the dispatch: this runs on every balance tick, and writing an
    // identical value would re-persist settings to localStorage each time.
    if (Math.abs(next - size) > 0.00005) {
      dispatch(updateSettings({ defaultPositionSize: next }));
    }
  }, [dispatch, touched, symbol, available, byMarket, size]);
}
