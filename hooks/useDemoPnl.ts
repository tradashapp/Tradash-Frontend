"use client";

import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { unrealizedPnl, isLiquidated } from "@/lib/perp";
import { patchDemoPosition, settleDemo } from "@/store/slices/tradingModeSlice";

// While in demo mode with an open position, recompute its unrealized PnL from
// the live oracle price and auto-liquidate if the price crosses the liq level.
// Live positions get their PnL from the Bulk account WS, so this only runs in demo.
export function useDemoPnl() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const position = useAppSelector((s) => s.tradingMode.demo.position);
  const price = useAppSelector(
    (s) => (position ? s.price.prices[position.symbol] : undefined)
  );

  useEffect(() => {
    if (mode !== "demo" || !position || price == null) return;

    if (isLiquidated(position, price)) {
      // Liquidation: lose the full margin.
      dispatch(settleDemo(-position.marginUsed));
      return;
    }

    const pnl = unrealizedPnl(
      position.direction,
      position.size,
      position.entryPrice,
      price
    );
    if (pnl !== position.unrealizedPnl) {
      dispatch(patchDemoPosition({ unrealizedPnl: pnl }));
    }
  }, [mode, position, price, dispatch]);
}
