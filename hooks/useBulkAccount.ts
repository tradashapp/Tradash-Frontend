"use client";

import { useEffect, useRef } from "react";
import { subscribeAccount } from "@/lib/bulk/accountWs";
import { fetchAccount } from "@/lib/bulk/client";
import type { BulkPosition } from "@/lib/bulk/types";
import { MARKETS } from "@/lib/markets";
import { api } from "@/lib/api";
import { useAppDispatch, useAppStore } from "@/store/hooks";
import { setBalance } from "@/store/slices/userSlice";
import { setPosition } from "@/store/slices/positionSlice";
import { hydrateHistory } from "@/store/slices/historySlice";
import { recordClose } from "@/lib/history";
import type { Direction, MarketSymbol, Position } from "@/types";

const bulkToSym = Object.fromEntries(
  (Object.keys(MARKETS) as MarketSymbol[]).map((s) => [MARKETS[s].bulkSymbol, s])
) as Record<string, MarketSymbol>;

// Subscribes to the Bulk account WS for live balance + position, seeds a
// snapshot via the unsigned /account read, and detects position close
// (open→flat) to record the completed trade to history + the backend. This
// catches ALL live closes — manual, trail, liquidation, TP/SL — since every
// close ends with the position going flat.
export function useBulkAccount(
  walletAddress: string | null,
  privyId: string | null
) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  // Last-seen open live position, to reconstruct the trade when it goes flat.
  const lastOpen = useRef<Position | null>(null);

  useEffect(() => {
    if (!walletAddress) {
      dispatch(setBalance(null));
      dispatch(setPosition(null));
      lastOpen.current = null;
      return;
    }

    // Load this user's persisted live history from the backend (by Privy DID).
    if (privyId) {
      api
        .fetchHistory(privyId)
        .then((trades) => {
          if (trades.length) dispatch(hydrateHistory(trades));
        })
        .catch(() => {
          /* offline / no backend — keep whatever is local */
        });
    }

    // Seed snapshot (unsigned). null = account has never traded (flat).
    fetchAccount(walletAddress)
      .then((acct) => {
        if (!acct) {
          dispatch(setBalance({ equity: 0, available: 0, marginUsed: 0 }));
          dispatch(setPosition(null));
          lastOpen.current = null;
          return;
        }
        dispatch(
          setBalance({
            equity: acct.margin.totalBalance,
            available: acct.margin.availableBalance,
            marginUsed: acct.margin.marginUsed,
          })
        );
        const open = acct.positions.find((p) => p.size !== 0);
        const pos = open ? snapshotToPosition(open) : null;
        lastOpen.current = pos;
        dispatch(setPosition(pos));
      })
      .catch(() => {
        /* snapshot best-effort; WS will populate */
      });

    // Live stream. Detect open→flat transitions to record the closed trade.
    const unsub = subscribeAccount(walletAddress, {
      onBalance: (b) => dispatch(setBalance(b)),
      onPosition: (p) => {
        const prev = lastOpen.current;
        if (prev && !p) {
          // Position just closed — record it. Exit price = latest live price;
          // realized PnL = the last unrealized PnL we saw on the position.
          const exit =
            store.getState().price.prices[prev.symbol] ?? prev.entryPrice;
          const trade = recordClose(dispatch, prev, exit, prev.unrealizedPnl);
          if (privyId) {
            api.recordTrade(privyId, trade).catch(() => {
              /* best-effort; it's already in local history */
            });
          }
        }
        lastOpen.current = p;
        dispatch(setPosition(p));
      },
    });

    return unsub;
  }, [walletAddress, privyId, dispatch, store]);
}

function snapshotToPosition(open: BulkPosition): Position | null {
  const sym = bulkToSym[open.symbol];
  if (!sym) return null;
  const direction: Direction = open.size > 0 ? "long" : "short";
  // Margin used = notional / leverage (Bulk gives notional + leverage).
  const marginUsed =
    open.leverage > 0 ? Math.abs(open.notional) / open.leverage : 0;
  return {
    symbol: sym,
    direction,
    size: Math.abs(open.size),
    entryPrice: open.price,
    leverage: open.leverage,
    liquidationPrice: open.liquidationPrice,
    marginUsed,
    unrealizedPnl: open.unrealizedPnl,
    openedAt: Date.now(),
  };
}
