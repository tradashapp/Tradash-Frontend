"use client";

import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  unrealizedPnl,
  isLiquidated,
  ratchetTrail,
  trailHit,
} from "@/lib/perp";
import { patchDemoPosition, settleDemo } from "@/store/slices/tradingModeSlice";
import { recordClose } from "@/lib/history";
import { playSound, tickProfit } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { MarketSymbol } from "@/types";

// While in demo mode, this loop maintains EVERY open demo position (one per
// market): recompute PnL from that market's oracle price, auto-liquidate, and
// run the trailing stop. Profit "tick" sound fires only for the ACTIVE market so
// background markets don't create noise. Live positions get this from Bulk's WS.
export function useDemoPnl() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const positions = useAppSelector((s) => s.tradingMode.demo.positions);
  const prices = useAppSelector((s) => s.price.prices);
  const trailPct = useAppSelector((s) => s.settings.defaultTrailPct);
  const activeSymbol = useAppSelector((s) => s.market.active);

  useEffect(() => {
    if (mode !== "demo") return;

    for (const sym of Object.keys(positions) as MarketSymbol[]) {
      const position = positions[sym];
      const price = prices[sym];
      if (!position || price == null) continue;

      if (isLiquidated(position, price)) {
        recordClose(dispatch, position, price, -position.marginUsed);
        dispatch(settleDemo({ symbol: sym, pnl: -position.marginUsed }));
        if (sym === activeSymbol) {
          playSound("close");
          haptic("close");
        }
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
          recordClose(dispatch, position, price, pnl);
          dispatch(settleDemo({ symbol: sym, pnl }));
          if (sym === activeSymbol) {
            playSound("close");
            haptic("close");
          }
          continue;
        }
        const nextStop = ratchetTrail(
          position.direction,
          position.trailStopPrice,
          position.entryPrice,
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
  }, [mode, positions, prices, trailPct, activeSymbol, dispatch]);
}
