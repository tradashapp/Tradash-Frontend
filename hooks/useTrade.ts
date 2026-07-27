"use client";

import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { MARKETS } from "@/lib/markets";
import { openPosition, trailStopFor, canTrail, unrealizedPnl } from "@/lib/perp";
import {
  setDemoPosition,
  patchDemoPosition,
  settleDemo,
} from "@/store/slices/tradingModeSlice";
import { patchPosition } from "@/store/slices/positionSlice";
import { setOrderStatus, setOrderError } from "@/store/slices/tradingSlice";
import { recordClose } from "@/lib/history";
import {
  playSound,
  beginProfitTracking,
  stopProfitTracking,
} from "@/lib/sound";
import { haptic } from "@/lib/haptics";

// A "significant" profit move ~= 5% of the margin at risk.
const profitStepFor = (marginUsd: number) => Math.max(marginUsd * 0.05, 1);
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

  const rawPosition = mode === "demo" ? demoPosition : livePosition;

  // On-chart display PnL is recomputed from the SAME MagicBlock price the chart
  // shows, against a BASIS-ADJUSTED entry: Bulk's entry price shifted onto the
  // MagicBlock axis by the feed offset captured at open (entryBasis). This keeps
  // the line, the gradient color, and the PnL number coherent AND matching
  // Bulk's profit/loss direction. Bulk stays authoritative for account equity +
  // the realized PnL banked on close (which also includes funding fees).
  const position: Position | null =
    rawPosition && price != null
      ? (() => {
          const basis = rawPosition.entryBasis ?? 0;
          const chartEntry = rawPosition.entryPrice - basis;
          return {
            ...rawPosition,
            // Shift entry + liq + trail onto the MagicBlock axis so all chart
            // overlays line up with the (MagicBlock) price line.
            entryPrice: chartEntry,
            liquidationPrice: rawPosition.liquidationPrice
              ? rawPosition.liquidationPrice - basis
              : rawPosition.liquidationPrice,
            // trailStopPrice is already stored in MagicBlock axis (it's a UI/
            // trigger value seeded from MagicBlock price), so no basis shift.
            unrealizedPnl: unrealizedPnl(
              rawPosition.direction,
              rawPosition.size,
              chartEntry,
              price
            ),
          };
        })()
      : rawPosition;

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
        playSound("open");
        haptic("open");
        beginProfitTracking(profitStepFor(pos.marginUsed));
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
          refPrice: price,
        });
        dispatch(setOrderStatus("filled"));
        playSound("open");
        haptic("open");
        beginProfitTracking(profitStepFor(settings.defaultPositionSize));
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
      // Log the completed trade, then realize PnL into the demo balance.
      if (price != null) recordClose(dispatch, position, price, position.unrealizedPnl);
      dispatch(settleDemo(position.unrealizedPnl));
      playSound("close");
      haptic("close");
      stopProfitTracking();
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
        refPrice: price ?? position.entryPrice,
      });
      dispatch(setOrderStatus("filled"));
      playSound("close");
      haptic("close");
      stopProfitTracking();
      // Trade recorded to history when the WS confirms the position is flat.
    } catch (e) {
      dispatch(setOrderError(e instanceof Error ? e.message : "Close failed"));
    }
  }, [mode, position, signer, dispatch]);

  // Can a trail be armed right now? Only when in enough profit that the clamped
  // stop lands strictly in the profit zone (never at/below entry).
  const trailEligible =
    position != null &&
    price != null &&
    canTrail(
      position.direction,
      position.entryPrice,
      price,
      settings.defaultTrailPct
    );

  // Toggle the trailing stop. Activating seeds the stop clamped to entry (so it
  // sits in the profit band between entry and mark); the ratchet + auto-close
  // runs in useDemoPnl (demo) / the WS-driven path (live). Deactivating clears it.
  const toggleTrail = useCallback(() => {
    if (!position || price == null) return;
    if (position.trailActive) {
      const patch = { trailActive: false, trailStopPrice: undefined };
      dispatch(mode === "demo" ? patchDemoPosition(patch) : patchPosition(patch));
      return;
    }
    // Guard: only arm when eligible.
    if (
      !canTrail(position.direction, position.entryPrice, price, settings.defaultTrailPct)
    ) {
      return;
    }
    const patch = {
      trailActive: true,
      trailStopPrice: trailStopFor(
        position.direction,
        price,
        position.entryPrice,
        settings.defaultTrailPct
      ),
    };
    dispatch(mode === "demo" ? patchDemoPosition(patch) : patchPosition(patch));
  }, [position, price, mode, settings.defaultTrailPct, dispatch]);

  return {
    mode,
    position: position as Position | null,
    openLong: () => open("long"),
    openShort: () => open("short"),
    toggleTrail,
    trailActive: position?.trailActive ?? false,
    trailEligible,
    trailPct: settings.defaultTrailPct,
    close,
    hasPosition: position != null,
  };
}
