"use client";

import { useEffect } from "react";
import { subscribeAccount } from "@/lib/bulk/accountWs";
import { fetchAccount } from "@/lib/bulk/client";
import { MARKETS } from "@/lib/markets";
import { useAppDispatch } from "@/store/hooks";
import { setBalance } from "@/store/slices/userSlice";
import { setPosition } from "@/store/slices/positionSlice";
import type { Direction, MarketSymbol } from "@/types";

// Subscribes to the Bulk account WS for live balance + position, and seeds an
// initial snapshot via the unsigned /account read. Commits into user/position
// slices. No signature needed for either.
export function useBulkAccount(walletAddress: string | null) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!walletAddress) {
      dispatch(setBalance(null));
      dispatch(setPosition(null));
      return;
    }

    // Seed snapshot (unsigned).
    fetchAccount(walletAddress)
      .then((acct) => {
        dispatch(
          setBalance({
            equity: acct.equity,
            available: acct.available,
            marginUsed: acct.marginUsed,
          })
        );
        const bulkToSym = Object.fromEntries(
          (Object.keys(MARKETS) as MarketSymbol[]).map((s) => [
            MARKETS[s].bulkSymbol,
            s,
          ])
        );
        const open = acct.positions.find((p) => p.size !== 0);
        if (open) {
          const sym = bulkToSym[open.symbol];
          if (sym) {
            const direction: Direction = open.size > 0 ? "long" : "short";
            dispatch(
              setPosition({
                symbol: sym,
                direction,
                size: Math.abs(open.size),
                entryPrice: open.price,
                leverage: open.leverage,
                liquidationPrice: open.liquidationPrice,
                marginUsed: 0,
                unrealizedPnl: open.unrealizedPnl,
                openedAt: Date.now(),
              })
            );
          }
        } else {
          dispatch(setPosition(null));
        }
      })
      .catch(() => {
        /* snapshot best-effort; WS will populate */
      });

    // Live stream.
    const unsub = subscribeAccount(walletAddress, {
      onBalance: (b) => dispatch(setBalance(b)),
      onPosition: (p) => dispatch(setPosition(p)),
    });

    return unsub;
  }, [walletAddress, dispatch]);
}
