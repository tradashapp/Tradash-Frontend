"use client";

import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { MARKETS } from "@/lib/markets";
import { openPosition } from "@/lib/perp";
import {
  setDemoPosition,
  patchDemoPosition,
  settleDemo,
} from "@/store/slices/tradingModeSlice";
import { computeSize } from "@/lib/perp";
import { setOrderStatus, setOrderError } from "@/store/slices/tradingSlice";
import { openMarket, reduceMarket, baseSizeFromUsd } from "@/lib/bulk/orders";
import type { AgentSigner } from "@/lib/bulk/signing";
import type { Direction, Position } from "@/types";

// The single entry point the UI uses to trade. Routes to the demo simulator or
// the live Bulk client based on the current mode, behind one identical API.
// Live trading requires a ready agent signer (passed in from useAgentWallet).
export function useTrade(signer: AgentSigner | null) {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const activeSymbol = useAppSelector((s) => s.market.active);
  const settings = useAppSelector((s) => s.settings);
  const livePosition = useAppSelector((s) => s.position.current);
  const demoPosition = useAppSelector((s) => s.tradingMode.demo.position);
  const price = useAppSelector((s) => s.price.prices[activeSymbol]);

  const position = mode === "demo" ? demoPosition : livePosition;

  const open = useCallback(
    async (direction: Direction) => {
      if (price == null) return;
      const market = MARKETS[activeSymbol];

      if (mode === "demo") {
        // Simulate: create a position at the current oracle price.
        const pos = openPosition({
          symbol: activeSymbol,
          direction,
          marginUsd: settings.defaultPositionSize,
          leverage: settings.defaultLeverage,
          entryPrice: price,
        });
        dispatch(setDemoPosition(pos));
        return;
      }

      // Live: one-tap market order via the agent signer.
      if (!signer) {
        dispatch(setOrderError("Connect wallet to trade live"));
        return;
      }
      dispatch(setOrderStatus("submitting"));
      try {
        const size = baseSizeFromUsd(
          settings.defaultPositionSize,
          settings.defaultLeverage,
          price
        );
        await openMarket(signer, {
          bulkSymbol: market.bulkSymbol,
          isLong: direction === "long",
          size,
        });
        dispatch(setOrderStatus("filled"));
        // Position appears via the account WS.
      } catch (e) {
        dispatch(setOrderError(e instanceof Error ? e.message : "Order failed"));
      }
    },
    [mode, price, activeSymbol, settings, signer, dispatch]
  );

  const close = useCallback(async () => {
    if (!position) return;
    const market = MARKETS[position.symbol];

    if (mode === "demo") {
      // Realize PnL into the demo balance.
      dispatch(settleDemo(position.unrealizedPnl));
      return;
    }

    if (!signer) {
      dispatch(setOrderError("Connect wallet to trade live"));
      return;
    }
    dispatch(setOrderStatus("submitting"));
    try {
      await reduceMarket(signer, {
        bulkSymbol: market.bulkSymbol,
        positionIsLong: position.direction === "long",
        size: position.size,
      });
      dispatch(setOrderStatus("filled"));
    } catch (e) {
      dispatch(setOrderError(e instanceof Error ? e.message : "Close failed"));
    }
  }, [mode, position, signer, dispatch]);

  // Increase the position by `pct` of the default margin (adds size at price).
  const increase = useCallback(
    async (pct: number) => {
      if (!position || price == null) return;
      const market = MARKETS[position.symbol];
      const addMargin = settings.defaultPositionSize * pct;
      const addSize = computeSize(addMargin, position.leverage, price);

      if (mode === "demo") {
        // Blend entry price by size-weighted average.
        const newSize = position.size + addSize;
        const newEntry =
          (position.entryPrice * position.size + price * addSize) / newSize;
        dispatch(
          patchDemoPosition({
            size: newSize,
            entryPrice: newEntry,
            marginUsed: position.marginUsed + addMargin,
          })
        );
        return;
      }
      if (!signer) return dispatch(setOrderError("Connect wallet to trade live"));
      dispatch(setOrderStatus("submitting"));
      try {
        await openMarket(signer, {
          bulkSymbol: market.bulkSymbol,
          isLong: position.direction === "long",
          size: addSize,
        });
        dispatch(setOrderStatus("filled"));
      } catch (e) {
        dispatch(setOrderError(e instanceof Error ? e.message : "Increase failed"));
      }
    },
    [position, price, mode, settings, signer, dispatch]
  );

  // Decrease by `pct` of the position (1 / "max" fully closes).
  const decrease = useCallback(
    async (pct: number) => {
      if (!position) return;
      if (pct >= 1) return close();
      const market = MARKETS[position.symbol];
      const reduceSize = position.size * pct;

      if (mode === "demo") {
        // Realize the reduced portion's PnL; keep the rest open.
        const realized = position.unrealizedPnl * pct;
        dispatch(settleDemo(realized)); // settleDemo clears position; re-open remainder
        dispatch(
          setDemoPosition({
            ...position,
            size: position.size - reduceSize,
            marginUsed: position.marginUsed * (1 - pct),
            unrealizedPnl: position.unrealizedPnl * (1 - pct),
          })
        );
        return;
      }
      if (!signer) return dispatch(setOrderError("Connect wallet to trade live"));
      dispatch(setOrderStatus("submitting"));
      try {
        await reduceMarket(signer, {
          bulkSymbol: market.bulkSymbol,
          positionIsLong: position.direction === "long",
          size: reduceSize,
        });
        dispatch(setOrderStatus("filled"));
      } catch (e) {
        dispatch(setOrderError(e instanceof Error ? e.message : "Decrease failed"));
      }
    },
    [position, mode, signer, dispatch, close]
  );

  return {
    mode,
    position: position as Position | null,
    openLong: () => open("long"),
    openShort: () => open("short"),
    increase,
    decrease,
    close,
    hasPosition: position != null,
  };
}
