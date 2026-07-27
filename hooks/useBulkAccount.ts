"use client";

import { useEffect, useRef } from "react";
import { subscribeAccount } from "@/lib/bulk/accountWs";
import { fetchAccount } from "@/lib/bulk/client";
import type { BulkPosition } from "@/lib/bulk/types";
import { MARKETS } from "@/lib/markets";
import { api } from "@/lib/api";
import { useAppDispatch, useAppStore } from "@/store/hooks";
import { setBalance } from "@/store/slices/userSlice";
import {
  setPosition,
  reconcilePositions,
  clearAllPositions,
} from "@/store/slices/positionSlice";
import { clearPendingChartEntry } from "@/store/slices/tradingSlice";
import { hydrateHistory } from "@/store/slices/historySlice";
import { recordClose } from "@/lib/history";
import type { Direction, MarketSymbol, Position } from "@/types";
import type { AppDispatch, AppStore } from "@/store";

const bulkToSym = Object.fromEntries(
  (Object.keys(MARKETS) as MarketSymbol[]).map((s) => [MARKETS[s].bulkSymbol, s])
) as Record<string, MarketSymbol>;

// Subscribes to the Bulk account WS. Bulk supports one position PER MARKET, so
// we track positions keyed by symbol: snapshots reconcile all markets, deltas
// update one market. On any market going flat we record the completed trade.
export function useBulkAccount(
  walletAddress: string | null,
  privyId: string | null
) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  // Last-seen open live position per market, to reconstruct trades on close.
  const lastOpen = useRef<Partial<Record<MarketSymbol, Position>>>({});

  useEffect(() => {
    if (!walletAddress) {
      dispatch(setBalance(null));
      dispatch(clearAllPositions());
      lastOpen.current = {};
      return;
    }

    // Load this user's persisted live history from the backend (by Privy DID).
    if (privyId) {
      api
        .fetchHistory(privyId)
        .then((trades) => {
          if (trades.length) dispatch(hydrateHistory(trades));
        })
        .catch(() => {});
    }

    // Seed snapshot (unsigned). null = account has never traded (flat).
    fetchAccount(walletAddress)
      .then((acct) => {
        if (!acct) {
          dispatch(setBalance({ equity: 0, available: 0, marginUsed: 0 }));
          dispatch(clearAllPositions());
          lastOpen.current = {};
          return;
        }
        dispatch(
          setBalance({
            equity: acct.margin.totalBalance,
            available: acct.margin.availableBalance,
            marginUsed: acct.margin.marginUsed,
            unrealizedPnl: acct.margin.unrealizedPnl,
          })
        );
        const open = acct.positions
          .filter((p) => p.size !== 0)
          .map((p) => snapshotToPosition(p))
          .filter((p): p is Position => p !== null)
          .map((p) => enrich(store, dispatch, p, lastOpen.current[p.symbol]));
        const map: Partial<Record<MarketSymbol, Position>> = {};
        for (const p of open) map[p.symbol] = p;
        lastOpen.current = map;
        dispatch(reconcilePositions(open));
      })
      .catch(() => {});

    const unsub = subscribeAccount(walletAddress, {
      onBalance: (b) => dispatch(setBalance(b)),

      // Full snapshot: reconcile ALL markets. Any previously-open market absent
      // from the incoming set has closed → record it.
      onSnapshot: (positions) => {
        const incoming: Partial<Record<MarketSymbol, Position>> = {};
        for (const p of positions) {
          incoming[p.symbol] = enrich(
            store,
            dispatch,
            p,
            lastOpen.current[p.symbol]
          );
        }
        // Detect closes: symbols we had open but are no longer present.
        for (const sym of Object.keys(lastOpen.current) as MarketSymbol[]) {
          if (!incoming[sym]) {
            recordCloseFor(store, dispatch, privyId, lastOpen.current[sym]!);
          }
        }
        lastOpen.current = incoming;
        dispatch(reconcilePositions(Object.values(incoming) as Position[]));
      },

      // Single-market delta.
      onPositionDelta: (symbol, p) => {
        const prev = lastOpen.current[symbol] ?? null;
        if (prev && !p) {
          recordCloseFor(store, dispatch, privyId, prev);
          delete lastOpen.current[symbol];
          dispatch(setPosition({ symbol, position: null }));
          return;
        }
        if (p) {
          const next = enrich(store, dispatch, p, prev ?? undefined);
          lastOpen.current[symbol] = next;
          dispatch(setPosition({ symbol, position: next }));
        }
      },
    });

    return unsub;
  }, [walletAddress, privyId, dispatch, store]);
}

// Attach the PnL anchor (Bulk PnL + MagicBlock price now), preserve openedAt, and
// on first open consume the tap-time MagicBlock price for the entry-line visual.
function enrich(
  store: AppStore,
  dispatch: AppDispatch,
  p: Position,
  prev: Position | undefined
): Position {
  const state = store.getState();
  const mbNow = state.price.prices[p.symbol];
  const tapEntry = !prev
    ? state.trading.pendingChartEntry[p.symbol]
    : prev.chartEntryPrice;
  if (!prev) dispatch(clearPendingChartEntry(p.symbol));
  return {
    ...p,
    openedAt: prev?.openedAt ?? p.openedAt,
    pnlAnchor: p.unrealizedPnl,
    priceAnchorMb: mbNow,
    chartEntryPrice: tapEntry ?? mbNow ?? p.entryPrice,
  };
}

function recordCloseFor(
  store: AppStore,
  dispatch: AppDispatch,
  privyId: string | null,
  prev: Position
) {
  const exit = store.getState().price.prices[prev.symbol] ?? prev.entryPrice;
  const trade = recordClose(dispatch, prev, exit, prev.unrealizedPnl);
  if (privyId) api.recordTrade(privyId, trade).catch(() => {});
}

function snapshotToPosition(open: BulkPosition): Position | null {
  const sym = bulkToSym[open.symbol];
  if (!sym) return null;
  const direction: Direction = open.size > 0 ? "long" : "short";
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
