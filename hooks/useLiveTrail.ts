"use client";

import { useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { MARKETS } from "@/lib/markets";
import { ratchetTrail, trailHit } from "@/lib/perp";
import { patchPosition } from "@/store/slices/positionSlice";
import { reduceMarket } from "@/lib/bulk/orders";
import type { AgentSigner } from "@/lib/bulk/signing";

// Live trailing stop. Mirrors useDemoPnl's ratchet, but on hit it submits a
// REAL reduce-only close via the agent signer. Runs off the live price in the
// store.
//
// LIMITATION: this trails only while the app/tab is open. A true always-on
// trailing stop needs a server-side keeper watching price 24/7 — deferred.
export function useLiveTrail(signer: AgentSigner | null) {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const position = useAppSelector((s) => s.position.current);
  const trailPct = useAppSelector((s) => s.settings.defaultTrailPct);
  const price = useAppSelector((s) =>
    position ? s.price.prices[position.symbol] : undefined
  );
  // Prevents firing the close order more than once while the WS confirms flat.
  const closing = useRef(false);

  useEffect(() => {
    if (
      mode !== "live" ||
      !position ||
      !position.trailActive ||
      position.trailStopPrice == null ||
      price == null ||
      !signer
    ) {
      return;
    }

    if (trailHit(position.direction, position.trailStopPrice, price)) {
      if (closing.current) return;
      closing.current = true;
      reduceMarket(signer, {
        bulkSymbol: MARKETS[position.symbol].bulkSymbol,
        positionIsLong: position.direction === "long",
        size: position.size,
      })
        .catch(() => {
          // Let it retry on the next tick if the order failed.
          closing.current = false;
        });
      return;
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
      dispatch(patchPosition({ trailStopPrice: nextStop }));
    }
  }, [mode, position, price, trailPct, signer, dispatch]);

  // Reset the lock when the position clears (WS confirmed flat).
  useEffect(() => {
    if (!position) closing.current = false;
  }, [position]);
}
