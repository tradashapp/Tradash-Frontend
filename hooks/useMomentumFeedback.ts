"use client";

import { useEffect, useRef } from "react";
import { useAppSelector, useAppStore } from "@/store/hooks";
import { MomentumTracker, type MomentumEvent } from "@/lib/momentum";
import {
  bulkToChartSpace,
  chartLiquidationPrice,
  demoPnlAt,
  livePnlAt,
} from "@/lib/perp";
import {
  playAdverseStep,
  playComboStep,
  playSlump,
  playSurge,
} from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { emitReaction } from "@/lib/reactions";
import { setMusicTense } from "@/lib/music";

// Losing this much ROI muffles the music (see setMusicTense).
const TENSE_ROI = -0.05;

// Game feel for the ACTIVE market's open position, in both modes: a chime on
// every move your way (climbing in pitch as the streak grows), a thud-less
// blip on moves against you, a surge cue + strong haptic when the market rips,
// and emoji callouts over the chart. lib/momentum decides what happened; this
// hook only turns its events into sound, haptics and reactions.
//
// Sound and haptics already self-gate on their settings. Callouts gate here on
// `reactionsEnabled`.
export function useMomentumFeedback() {
  const store = useAppStore();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const activeSymbol = useAppSelector((s) => s.market.active);
  // Driven by the active market's committed price (~5Hz), the same cadence the
  // header and PnL read. Positions are read from the store inside the effect so
  // a WS position update alone doesn't produce an extra, price-less sample.
  const price = useAppSelector((s) => s.price.prices[activeSymbol]);
  const tracker = useRef<MomentumTracker | null>(null);
  const tense = useRef(false);

  useEffect(() => {
    if (price == null) return;
    tracker.current ??= new MomentumTracker();
    const st = store.getState();
    const pos =
      mode === "demo"
        ? st.tradingMode.demo.positions[activeSymbol]
        : st.position.bySymbol[activeSymbol];

    const pnl = pos
      ? mode === "demo"
        ? demoPnlAt(pos, price)
        : livePnlAt(pos, price)
      : 0;

    const events = tracker.current.feed({
      t: performance.now(),
      symbol: activeSymbol,
      price,
      position: pos
        ? {
            key: `${mode}:${pos.symbol}:${pos.direction}:${pos.openedAt}`,
            direction: pos.direction,
            pnl,
            margin: pos.marginUsed,
            // Both in the chart's price space, like `price`.
            entryPrice: bulkToChartSpace(mode, pos, pos.entryPrice),
            liquidationPrice: chartLiquidationPrice(mode, pos),
          }
        : null,
    });
    for (const e of events) react(e, st.settings.reactionsEnabled);

    const nowTense = !!pos && pos.marginUsed > 0 && pnl / pos.marginUsed <= TENSE_ROI;
    if (nowTense !== tense.current) {
      tense.current = nowTense;
      setMusicTense(nowTense);
    }
  }, [price, mode, activeSymbol, store]);
}

function react(e: MomentumEvent, reactionsEnabled: boolean) {
  switch (e.kind) {
    case "step":
      if (e.favorable) {
        playComboStep(e.count);
        haptic("move");
      } else if (e.count >= 2) {
        // A single tick against you is noise; two in a row is a move.
        playAdverseStep();
      }
      return;
    case "surge":
      if (e.favorable) {
        playSurge(e.mega);
        haptic(e.mega ? "mega" : "surge");
      } else {
        playSlump();
        haptic("slump");
      }
      if (reactionsEnabled) {
        emitReaction({ kind: "flash", favorable: e.favorable, mega: e.mega });
      }
      return;
    case "callout":
      if (e.callout.tone === "warn") haptic("warn");
      if (reactionsEnabled) emitReaction({ kind: "callout", callout: e.callout });
      return;
  }
}
