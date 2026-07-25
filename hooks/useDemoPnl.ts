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

// While in demo mode with an open position, this loop:
//  - recomputes unrealized PnL from the live oracle price
//  - auto-liquidates if price crosses the liq level
//  - if a trailing stop is active: ratchets it toward profit, and auto-closes
//    (locking PnL) when price reverses into it
// Live positions get this behavior from the Bulk account WS instead.
export function useDemoPnl() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const position = useAppSelector((s) => s.tradingMode.demo.position);
  const trailPct = useAppSelector((s) => s.settings.defaultTrailPct);
  const price = useAppSelector((s) =>
    position ? s.price.prices[position.symbol] : undefined
  );

  useEffect(() => {
    if (mode !== "demo" || !position || price == null) return;

    if (isLiquidated(position, price)) {
      dispatch(settleDemo(-position.marginUsed)); // lose full margin
      return;
    }

    const pnl = unrealizedPnl(
      position.direction,
      position.size,
      position.entryPrice,
      price
    );

    // Trailing stop: ratchet toward profit, auto-close on reversal into it.
    if (position.trailActive && position.trailStopPrice != null) {
      if (trailHit(position.direction, position.trailStopPrice, price)) {
        dispatch(settleDemo(pnl)); // lock in the current PnL
        return;
      }
      const nextStop = ratchetTrail(
        position.direction,
        position.trailStopPrice,
        price,
        trailPct
      );
      const patch: Record<string, number> = {};
      if (nextStop !== position.trailStopPrice) patch.trailStopPrice = nextStop;
      if (pnl !== position.unrealizedPnl) patch.unrealizedPnl = pnl;
      if (Object.keys(patch).length) dispatch(patchDemoPosition(patch));
      return;
    }

    if (pnl !== position.unrealizedPnl) {
      dispatch(patchDemoPosition({ unrealizedPnl: pnl }));
    }
  }, [mode, position, price, trailPct, dispatch]);
}
