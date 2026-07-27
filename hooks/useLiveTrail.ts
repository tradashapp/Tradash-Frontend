"use client";

import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector, useAppStore } from "@/store/hooks";
import { MARKETS } from "@/lib/markets";
import { ratchetTrail, trailHit } from "@/lib/perp";
import { tickProfit } from "@/lib/sound";
import { patchPosition } from "@/store/slices/positionSlice";
import { reduceMarket } from "@/lib/bulk/orders";
import type { AgentSigner } from "@/lib/bulk/signing";
import type { MarketSymbol } from "@/types";

// Live trailing stop, per market. Mirrors useDemoPnl's ratchet, but on hit it
// submits a REAL reduce-only close via the agent signer. Runs off each market's
// live price.
//
// LIMITATION: trails only while the app/tab is open. A true always-on trailing
// stop needs a server-side keeper watching price 24/7 — deferred.
export function useLiveTrail(signer: AgentSigner | null) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const positions = useAppSelector((s) => s.position.bySymbol);
  const trailPct = useAppSelector((s) => s.settings.defaultTrailPct);
  const activeSymbol = useAppSelector((s) => s.market.active);
  // Trigger off the active market's committed price (stable primitive); read all
  // prices from the store to avoid re-running on every price object change.
  const tick = useAppSelector((s) => s.price.prices[activeSymbol]);
  // Per-market lock so we don't fire the close order twice before the WS confirms.
  const closing = useRef<Partial<Record<MarketSymbol, boolean>>>({});

  // Celebrate profit moves for the ACTIVE market (PnL kept fresh by the WS).
  useEffect(() => {
    if (mode !== "live") return;
    const p = positions[activeSymbol];
    if (p) tickProfit(p.unrealizedPnl);
  }, [mode, positions, activeSymbol]);

  useEffect(() => {
    if (mode !== "live" || !signer) return;
    void tick;
    const prices = store.getState().price.prices;

    for (const sym of Object.keys(positions) as MarketSymbol[]) {
      const position = positions[sym];
      const price = prices[sym];
      if (
        !position ||
        !position.trailActive ||
        position.trailStopPrice == null ||
        price == null
      ) {
        continue;
      }

      if (trailHit(position.direction, position.trailStopPrice, price)) {
        if (closing.current[sym]) continue;
        closing.current[sym] = true;
        reduceMarket(signer, {
          bulkSymbol: MARKETS[sym].bulkSymbol,
          positionIsLong: position.direction === "long",
          size: position.size,
          refPrice: price,
        }).catch(() => {
          closing.current[sym] = false; // allow retry
        });
        continue;
      }

      // Ratchet the stop toward profit (clamped to entry).
      const nextStop = ratchetTrail(
        position.direction,
        position.trailStopPrice,
        position.entryPrice,
        price,
        trailPct
      );
      if (nextStop !== position.trailStopPrice) {
        dispatch(patchPosition({ symbol: sym, patch: { trailStopPrice: nextStop } }));
      }
    }
  }, [mode, positions, tick, trailPct, signer, store, dispatch]);

  // Clear the lock for any market that's no longer open (WS confirmed flat).
  useEffect(() => {
    for (const sym of Object.keys(closing.current) as MarketSymbol[]) {
      if (!positions[sym]) closing.current[sym] = false;
    }
  }, [positions]);
}
