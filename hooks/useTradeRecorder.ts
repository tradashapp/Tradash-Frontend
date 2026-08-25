"use client";

import { useEffect, useRef } from "react";
import { useAppSelector, useAppStore } from "@/store/hooks";
import {
  abortEpisode,
  fillGap,
  isRecording,
  pendingGaps,
  record,
  startEpisode,
} from "@/lib/replay/recorder";
import { fetchGapPrices, isBackfillable } from "@/lib/replay/backfill";
import { breakEvenPrice } from "@/lib/perp";
import { MARKET_ORDER } from "@/lib/markets";
import { subscribeToPrice } from "@/lib/oracle/magicblock";
import type { MarketSymbol, Position } from "@/types";

// Drives the replay recorder: opens an episode when a position appears, feeds
// it oracle ticks, and abandons it if the position vanishes without a close
// (e.g. sign-out or a mode switch — a real close seals via recordClose).
//
// Subscribes to EVERY market's feed rather than reading the active chart,
// because the chart only covers the active market: a position left open on a
// backgrounded market would otherwise record nothing and replay as a hole.
// This mirrors useAllPrices, and both share one Connection/WebSocket.
export function useTradeRecorder() {
  const store = useAppStore();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const livePositions = useAppSelector((s) => s.position.bySymbol);
  const demoPositions = useAppSelector((s) => s.tradingMode.demo.positions);

  // Read positions from the store inside the tick callback so the subscription
  // itself never has to be torn down and rebuilt as positions change.
  const positionsRef = useRef<Partial<Record<MarketSymbol, Position>>>({});
  positionsRef.current = mode === "demo" ? demoPositions : livePositions;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Feed every market's ticks to the recorder. The recorder ignores markets
  // with no episode in flight, and time-gates sampling to ~10Hz, so pushing the
  // full ~16 ticks/s here is cheap.
  useEffect(() => {
    const unsubs = MARKET_ORDER.map((symbol) =>
      subscribeToPrice(symbol, (price) => {
        if (isRecording(symbol)) record(symbol, price);
      })
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  // Open/abort episodes as positions come and go.
  useEffect(() => {
    const positions = mode === "demo" ? demoPositions : livePositions;
    const prices = store.getState().price.prices;

    for (const symbol of MARKET_ORDER) {
      const position = positions[symbol];

      if (position) {
        if (isRecording(symbol)) continue;
        const price = prices[symbol];
        // Without a price there is no sample to seed with; the next render
        // after the feed connects will start the episode instead.
        if (price == null) continue;
        startEpisode({
          mode,
          symbol,
          direction: position.direction,
          openedAt: position.openedAt,
          // The chart draws entry at the BREAK-EVEN price, not Bulk's
          // entryPrice — replay has to match what the user actually saw.
          entryLine: breakEvenPrice(mode, position),
          liqLine: position.liquidationPrice,
          price,
        });
      } else if (isRecording(symbol)) {
        // A close seals the episode from recordClose before the position is
        // cleared, so anything still recording here disappeared WITHOUT a
        // realized close (sign-out, mode switch, reconnect wiping state).
        // Sealing it would file a trade row that never happened.
        abortEpisode(symbol);
      }
    }
  }, [mode, livePositions, demoPositions, store]);

  // Drop in-flight recordings when the trading mode flips: demo and live
  // positions are different accounts, and their paths must never merge.
  useEffect(() => {
    return () => {
      for (const symbol of MARKET_ORDER) abortEpisode(symbol);
    };
  }, [mode]);

  // Backfill gaps as soon as the tab wakes, NOT lazily at replay time. The
  // klines endpoint only retains ~3h, so a gap left unpatched until the user
  // opens the replay is usually already expired — patching on wake is what
  // makes that short window actually useful, and it covers the common cases
  // (a backgrounded PWA, a closed laptop lid) rather than the rare ones.
  useEffect(() => {
    const backfill = () => {
      if (document.visibilityState !== "visible") return;
      for (const symbol of MARKET_ORDER) {
        if (!isRecording(symbol)) continue;
        for (const gap of pendingGaps(symbol)) {
          if (!isBackfillable(gap)) continue;
          void fetchGapPrices(symbol, gap.from, gap.to).then((prices) => {
            if (prices.length > 0) fillGap(symbol, gap, prices);
          });
        }
      }
    };

    document.addEventListener("visibilitychange", backfill);
    // Also run once on mount: a fresh load after the app was closed has the
    // same hole, and there is no visibility transition to hear.
    backfill();
    return () => document.removeEventListener("visibilitychange", backfill);
  }, []);
}
