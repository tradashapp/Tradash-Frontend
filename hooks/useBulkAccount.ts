"use client";

import { useEffect, useRef } from "react";
import { subscribeAccount } from "@/lib/bulk/accountWs";
import { fetchAccount } from "@/lib/bulk/client";
import { readMargin } from "@/lib/bulk/types";
import { isDustSize } from "@/lib/bulk/orders";
import { readProtection } from "@/lib/bulk/protection";
import type { BulkPosition } from "@/lib/bulk/types";
import { MARKETS } from "@/lib/markets";
import { api } from "@/lib/api";
import { useAppDispatch, useAppStore } from "@/store/hooks";
import { setBalance, mergeBalance } from "@/store/slices/userSlice";
import {
  setPosition,
  reconcilePositions,
  clearAllPositions,
} from "@/store/slices/positionSlice";
import { clearPendingChartEntry } from "@/store/slices/tradingSlice";
import { setOpenOrders } from "@/store/slices/ordersSlice";
import { readLimitOrders } from "@/lib/bulk/limits";
import {
  hydrateLiveHistory,
  markLiveHydrated,
} from "@/store/slices/historySlice";
import { recordClose } from "@/lib/history";
import { hydrateLiveEpisodes } from "@/store/slices/replaySlice";
import { useToast, type ToastOptions } from "@/components/toast/ToastProvider";
import type { Direction, MarketSymbol, Position } from "@/types";
import type { AppDispatch, AppStore } from "@/store";

type ToastFn = (title: string, opts?: ToastOptions) => string;

const fmtUsd = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

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
  const { toast } = useToast();
  // Last-seen open live position per market, to reconstruct trades on close.
  const lastOpen = useRef<Partial<Record<MarketSymbol, Position>>>({});

  useEffect(() => {
    if (!walletAddress) {
      dispatch(setBalance(null));
      dispatch(clearAllPositions());
      dispatch(setOpenOrders([]));
      // Signed out: there is no live history to wait for, so settle the flag or
      // the history panel would show a loading state indefinitely.
      dispatch(markLiveHydrated());
      lastOpen.current = {};
      return;
    }

    // Load this user's persisted live history from the backend (by Privy DID).
    // The backend rebuilds history from Bulk's fills before answering, so this
    // also brings in closes that happened while the app was shut (a TP/SL or
    // trailing stop firing server-side, a liquidation, another device).
    // No DID means nothing to fetch — settle the flag so the panel renders its
    // empty state instead of waiting on a request that will never be made.
    if (!privyId) dispatch(markLiveHydrated());
    if (privyId) {
      api
        .fetchHistory(privyId)
        .then((trades) => {
          // Always apply: an empty result means this user has no live trades,
          // so any stale live rows should be cleared while demo trades stay.
          dispatch(hydrateLiveHistory(trades));
        })
        .catch(() => {
          // Failed fetch still settles the flag: showing the empty state is
          // wrong but recoverable, whereas an endless skeleton is a dead end.
          dispatch(markLiveHydrated());
        });

      // Recorded price paths for replaying those trades. Optional data — a
      // failure here must never affect the history itself.
      api
        .fetchEpisodes(privyId)
        .then((episodes) => dispatch(hydrateLiveEpisodes(episodes)))
        .catch(() => {});
    }

    let disposed = false;
    // Seed snapshot (unsigned). null = account has never traded (flat). Also
    // re-run after an add/reduce fills — see onPositionDelta.
    const seed = () =>
      fetchAccount(walletAddress)
        .then((acct) => {
          if (disposed) return;
          if (!acct) {
            dispatch(setBalance({ equity: 0, available: 0, marginUsed: 0 }));
            dispatch(clearAllPositions());
            dispatch(setOpenOrders([]));
            lastOpen.current = {};
            return;
          }
          // Bulk renamed these (totalBalance→totalMargin, availableBalance→
          // availableMargin), so read them through the normalizer rather than by
          // a single hard-coded spelling.
          dispatch(setOpenOrders(readLimitOrders(acct.openOrders)));
          const m = readMargin(acct.margin);
          dispatch(
            setBalance({
              equity: m.equity ?? 0,
              available: m.available ?? 0,
              marginUsed: m.marginUsed ?? 0,
              unrealizedPnl: m.unrealizedPnl ?? 0,
            })
          );
          // NOTE: dust rows (a sub-lot residue left by a close that filled a hair
          // short) are dropped by `snapshotToPosition`, so they never seed
          // `lastOpen` and never render. That is deliberate — they are unclosable
          // — but it also means a position that shrank to dust while we were NOT
          // connected produces no open→absent transition here, and so no history
          // row here. The backend's Bulk fills sync records it instead (it treats
          // sub-lot residue as flat, the same rule), so this is only a diagnostic.
          for (const raw of acct.positions) {
            const sym = bulkToSym[raw.symbol];
            if (!sym || raw.size === 0) continue;
            if (isDustSize(raw.size, MARKETS[sym].lotSize)) {
              console.warn(
                `[tradash] ${raw.symbol} is stranded dust (size ${raw.size}); ` +
                  `its close was never recorded to history and cannot be ` +
                  `reconstructed from /account — the backend fills sync records it.`
              );
            }
          }
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
    seed();
    let resyncTimer: ReturnType<typeof setTimeout> | null = null;

    // Re-read ONLY the open orders. Bulk's orderUpdate/fill deltas say that
    // something changed; the list itself is taken from REST, so a limit that
    // filled, was cancelled on another device or hit a risk limit drops out
    // without trusting a delta's shape. Debounced: one fill emits several.
    let ordersTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshOrders = () => {
      if (ordersTimer) clearTimeout(ordersTimer);
      ordersTimer = setTimeout(() => {
        fetchAccount(walletAddress)
          .then((acct) => {
            if (!disposed) {
              dispatch(setOpenOrders(readLimitOrders(acct?.openOrders)));
            }
          })
          .catch(() => {});
      }, 400);
    };

    const unsub = subscribeAccount(walletAddress, {
      // A snapshot is authoritative and replaces the balance; a delta is
      // partial and must be MERGED. Replacing on a delta is what previously
      // zeroed `equity` and left the pill showing PnL-since-load only.
      onBalance: (b, snapshot) =>
        dispatch(snapshot ? setBalance(b) : mergeBalance(b)),

      onOrders: (orders) => dispatch(setOpenOrders(orders)),
      onOrderEvent: refreshOrders,

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
        // New opens (were flat, now present) → confirm the pending open toast.
        for (const sym of Object.keys(incoming) as MarketSymbol[]) {
          if (!lastOpen.current[sym]) toastOpen(toast, incoming[sym]!);
        }
        // Detect closes: symbols we had open but are no longer present.
        for (const sym of Object.keys(lastOpen.current) as MarketSymbol[]) {
          if (!incoming[sym]) {
            recordCloseFor(store, dispatch, privyId, lastOpen.current[sym]!, toast);
          }
        }
        lastOpen.current = incoming;
        dispatch(reconcilePositions(Object.values(incoming) as Position[]));
      },

      // Single-market delta.
      onPositionDelta: (symbol, p) => {
        // A position change may be a resting limit filling — re-read the list
        // even if no orderUpdate arrives for it.
        refreshOrders();
        const prev = lastOpen.current[symbol] ?? null;
        if (prev && !p) {
          recordCloseFor(store, dispatch, privyId, prev, toast);
          delete lastOpen.current[symbol];
          dispatch(setPosition({ symbol, position: null }));
          return;
        }
        if (p) {
          const next = enrich(store, dispatch, p, prev ?? undefined);
          if (!prev) {
            toastOpen(toast, next); // flat → open: confirm the fill
          } else if (Math.abs(next.size - prev.size) > prev.size * 1e-6) {
            // open → open with a SIZE change = an add / reduce filled. Resolve
            // the pending adjust toast (keyed adjust-<sym>) that increase()/
            // decrease() opened, so it never spins forever, and log the event to
            // history (WS is the source of truth for the real filled size/PnL).
            toastAdjust(toast, prev, next);
            recordAdjustFor(store, dispatch, privyId, prev, next);
            // Re-read the position from REST once the fill has settled, so the
            // AVERAGE entry (Bulk's VWAP), liquidation and break-even lines all
            // come from Bulk's full snapshot rather than trusting this single
            // delta to carry every re-averaged field.
            if (resyncTimer) clearTimeout(resyncTimer);
            resyncTimer = setTimeout(seed, 750);
          }
          lastOpen.current[symbol] = next;
          dispatch(setPosition({ symbol, position: next }));
        }
      },
    });

    return () => {
      disposed = true;
      if (resyncTimer) clearTimeout(resyncTimer);
      if (ordersTimer) clearTimeout(ordersTimer);
      unsub();
    };
  }, [walletAddress, privyId, dispatch, store, toast]);
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
  prev: Position,
  toast: ToastFn
) {
  const exit = store.getState().price.prices[prev.symbol] ?? prev.entryPrice;
  const trade = recordClose(dispatch, "live", prev, exit, prev.unrealizedPnl);
  // Queued through the outbox: this resolves once the write has either landed
  // or been persisted for retry, so the trade survives an API outage.
  //
  // This row is the client's view (MagicBlock exit, anchored PnL). Once it has
  // landed, re-read history: the backend rebuilds the trade from Bulk's fills
  // on that read and hides this row behind the exchange's real one (true exit,
  // fees, funding), so the list shows the real numbers without a reload.
  if (privyId) {
    void api.recordTrade(privyId, trade).then((landed) => {
      if (!landed) return;
      api
        .fetchHistory(privyId)
        .then((trades) => dispatch(hydrateLiveHistory(trades)))
        .catch(() => {});
    });
  }
  // recordClose sealed the recording into the store — upload it so the replay
  // survives a reload and follows the user across devices. Best-effort: a
  // failed upload costs a replay, never the trade row.
  if (privyId && trade.episodeId) {
    const episode = store.getState().replay.byId[trade.episodeId];
    if (episode) void api.recordEpisode(privyId, episode);
  }
  // Confirm the close (upgrades the pending close-<sym> loading toast if present).
  toast(`Closed ${prev.symbol}`, {
    type: prev.unrealizedPnl >= 0 ? "success" : "info",
    id: `close-${prev.symbol}`,
    description: `Realized ${fmtUsd(prev.unrealizedPnl)}`,
    // Only an actual gain earns the burst — break-even closes stay quiet so the
    // celebration keeps meaning something.
    confetti: prev.unrealizedPnl > 0,
  });
}

// Log a live add / reduce to trade history. An `add` has no realized PnL; a
// `reduce` realizes the portion that left the position (prev PnL scaled by the
// fraction reduced). Size logged is the delta actually filled.
function recordAdjustFor(
  store: AppStore,
  dispatch: AppDispatch,
  privyId: string | null,
  prev: Position,
  next: Position
) {
  const delta = Math.abs(next.size - prev.size);
  if (next.size > prev.size) {
    // Added size — informational row, no realized PnL.
    const t = recordClose(dispatch, "live", next, next.entryPrice, 0, "add", delta);
    if (privyId) void api.recordTrade(privyId, t);
  } else {
    // Reduced size — realize the reduced fraction of the prior PnL.
    const exit = store.getState().price.prices[prev.symbol] ?? prev.entryPrice;
    const realized =
      prev.size > 0 ? prev.unrealizedPnl * (delta / prev.size) : 0;
    const t = recordClose(dispatch, "live", prev, exit, realized, "reduce", delta);
    if (privyId) void api.recordTrade(privyId, t);
  }
}

// Confirm a live add / reduce (upgrades the pending adjust-<sym> loading toast
// that increase()/decrease() opened). Fires only on an open→open SIZE change.
function toastAdjust(toast: ToastFn, prev: Position, next: Position) {
  const added = next.size > prev.size;
  toast(`${added ? "Added to" : "Reduced"} ${next.symbol}`, {
    type: added ? "success" : "info",
    id: `adjust-${next.symbol}`,
    description: `${next.leverage}× · ${fmtUsd(next.marginUsed).replace("+", "")} margin`,
  });
}

// Confirm a live open (upgrades the pending open-<sym> loading toast).
function toastOpen(toast: ToastFn, pos: Position) {
  toast(`${pos.direction === "long" ? "Long" : "Short"} ${pos.symbol} opened`, {
    type: "success",
    id: `open-${pos.symbol}`,
    description: `${pos.leverage}× · ${fmtUsd(pos.marginUsed).replace("+", "")} margin`,
  });
}

function snapshotToPosition(open: BulkPosition): Position | null {
  const sym = bulkToSym[open.symbol];
  if (!sym) return null;
  // Sub-lot residue from a close that filled a hair short — unclosable on Bulk
  // and economically zero. Mirrors the same filter on the WS path (toPosition
  // in lib/bulk/accountWs.ts); both must agree or the REST snapshot would
  // resurrect a position the stream drops.
  if (isDustSize(open.size, MARKETS[sym].lotSize)) return null;
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
    // Bulk's own mark + charged costs: the first translates Bulk-quoted lines
    // into the chart's MagicBlock space, the second draws the net break-even.
    markPriceBulk: open.fairPrice,
    realizedPnl: open.realizedPnl,
    // Resting TP/SL/trailing. Must match the WS path (toPosition) or a refetch
    // would blank out protection the stream had already shown.
    protection: readProtection(open.protection?.orders),
    openedAt: Date.now(),
  };
}
