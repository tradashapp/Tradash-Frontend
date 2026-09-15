"use client";

import { useEffect } from "react";
import { useAppDispatch, useAppSelector, useAppStore } from "@/store/hooks";
import {
  unrealizedPnl,
  isLiquidated,
  ratchetTrail,
  trailHit,
  trailReferencePrice,
} from "@/lib/perp";
import { patchDemoPosition, settleDemo } from "@/store/slices/tradingModeSlice";
import { recordClose } from "@/lib/history";
import { playCloseOutcome, tickProfit } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { useToast } from "@/components/toast/ToastProvider";
import type { MarketSymbol } from "@/types";

const fmtUsd = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// While in demo mode, this loop maintains EVERY open demo position (one per
// market): recompute PnL from that market's oracle price, auto-liquidate, and
// run the trailing stop. Profit "tick" sound fires only for the ACTIVE market so
// background markets don't create noise. Live positions get this from Bulk's WS.
export function useDemoPnl() {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const { toast } = useToast();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const positions = useAppSelector((s) => s.tradingMode.demo.positions);
  const trailPct = useAppSelector((s) => s.settings.defaultTrailPct);
  const activeSymbol = useAppSelector((s) => s.market.active);
  // Trigger the loop on the ACTIVE market's committed price (a stable primitive),
  // then read all prices from the store — avoids re-running on every price
  // object-identity change (which caused a re-render storm).
  const tick = useAppSelector((s) => s.price.prices[activeSymbol]);

  useEffect(() => {
    if (mode !== "demo") return;
    void tick;
    const prices = store.getState().price.prices;

    for (const sym of Object.keys(positions) as MarketSymbol[]) {
      const position = positions[sym];
      const price = prices[sym];
      if (!position || price == null) continue;

      if (isLiquidated(position, price)) {
        recordClose(dispatch, "demo", position, price, -position.marginUsed);
        dispatch(settleDemo({ symbol: sym, pnl: -position.marginUsed }));
        if (sym === activeSymbol) {
          // Liquidation is always a loss — the whole margin is gone.
          playCloseOutcome(-position.marginUsed);
          haptic("close");
        }
        toast(`${sym} liquidated`, {
          type: "error",
          description: `Lost ${fmtUsd(-position.marginUsed)} margin`,
        });
        continue;
      }

      const pnl = unrealizedPnl(
        position.direction,
        position.size,
        position.entryPrice,
        price
      );

      if (sym === activeSymbol) tickProfit(pnl);

      // Trailing stop: ratchet toward profit, auto-close on reversal into it.
      if (position.trailActive && position.trailStopPrice != null) {
        if (trailHit(position.direction, position.trailStopPrice, price)) {
          recordClose(dispatch, "demo", position, price, pnl);
          dispatch(settleDemo({ symbol: sym, pnl }));
          if (sym === activeSymbol) {
            playCloseOutcome(pnl);
            haptic("close");
          }
          toast(`Trailing stop hit · ${sym}`, {
            type: pnl >= 0 ? "success" : "info",
            description: `Locked ${fmtUsd(pnl)}`,
            confetti: pnl > 0,
          });
          continue;
        }
        // Demo prices all come from the one feed, so this resolves to
        // entryPrice — routed through the shared helper anyway so every trail
        // site clamps by the same rule and none can drift out of step.
        const nextStop = ratchetTrail(
          position.direction,
          position.trailStopPrice,
          trailReferencePrice("demo", position),
          price,
          trailPct
        );
        const patch: Record<string, number> = {};
        if (nextStop !== position.trailStopPrice) patch.trailStopPrice = nextStop;
        if (pnl !== position.unrealizedPnl) patch.unrealizedPnl = pnl;
        if (Object.keys(patch).length)
          dispatch(patchDemoPosition({ symbol: sym, patch }));
        continue;
      }

      if (pnl !== position.unrealizedPnl) {
        dispatch(patchDemoPosition({ symbol: sym, patch: { unrealizedPnl: pnl } }));
      }
    }
  }, [mode, positions, tick, trailPct, activeSymbol, store, dispatch, toast]);
}
