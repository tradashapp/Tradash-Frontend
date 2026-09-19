"use client";

import { useEffect, useRef } from "react";
import { subscribeAccount } from "@/lib/phoenix/accountWs";
import { readAccount } from "@/lib/phoenix/account";
import { useAppDispatch, useAppStore } from "@/store/hooks";
import { setBalance } from "@/store/slices/userSlice";
import {
  reconcilePositions,
  clearAllPositions,
} from "@/store/slices/positionSlice";
import { markLiveHydrated } from "@/store/slices/historySlice";
import type { MarketSymbol } from "@/types";

/**
 * Live Phoenix account state → the Redux store.
 *
 * The Phoenix counterpart of `useBulkAccount`, and deliberately much smaller,
 * because Phoenix removes work Bulk forced on the client:
 *
 *   - No margin-field normalisation. Bulk renamed `totalBalance`→`totalMargin`
 *     mid-flight, so every read went through `readMargin`. Phoenix returns
 *     `{value, decimals, ui}` integers with stable names.
 *   - No snapshot-vs-delta merge. Bulk's websocket pushed PARTIAL balance
 *     deltas that had to be merged or equity would zero out. Here the stream is
 *     only a change notification and every value is re-read from REST, so there
 *     is no partial state to reconcile.
 *   - No history capture. Bulk history was written from the browser on an
 *     open→absent transition, which silently lost a close that happened while
 *     disconnected (`useBulkAccount.ts:118`). Phoenix history is indexed
 *     server-side from fills, so this hook does not write trades at all.
 *
 * WHY REST AND NOT THE STREAM'S CONTENTS: the `traderState` channel sends raw
 * per-subaccount collateral with no equity, margin requirement, PnL or risk
 * state. Computing those here would duplicate Phoenix's risk engine, and a
 * mismatch would draw a wrong liquidation line. So the stream says WHEN, REST
 * says WHAT.
 */
export function usePhoenixAccount(
  /** Owner wallet — the authority the stream and PDA derive from. */
  authority: string | null,
  /** Trader PDA for subaccount 0 (cross). Null until derived. */
  traderPda: string | null
) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  // Guards against a stale in-flight read landing after a newer one.
  const readSeq = useRef(0);

  useEffect(() => {
    if (!authority || !traderPda) {
      dispatch(setBalance(null));
      dispatch(clearAllPositions());
      // History is server-indexed on Phoenix, so nothing here will hydrate it;
      // marking it hydrated stops the UI waiting on a write that never comes.
      dispatch(markLiveHydrated());
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const seq = ++readSeq.current;
      // Mark prices come from the MagicBlock oracle already in the store, so a
      // position's PnL is computed against the same feed the chart draws.
      const prices = store.getState().price.prices as Partial<
        Record<MarketSymbol, number>
      >;
      const account = await readAccount(traderPda, prices).catch(() => null);
      // A later read has already landed — discard this one.
      if (cancelled || seq !== readSeq.current) return;

      if (!account) {
        // No trader account yet: the user has never funded Phoenix. Flat, not
        // an error.
        dispatch(setBalance({ equity: 0, available: 0, marginUsed: 0 }));
        dispatch(clearAllPositions());
        return;
      }
      dispatch(setBalance(account.balance));
      dispatch(reconcilePositions(account.positions));
    };

    // Seed immediately, then re-read whenever the account changes on chain.
    void refresh();
    const unsub = subscribeAccount(authority, { onChange: () => void refresh() });

    dispatch(markLiveHydrated());

    return () => {
      cancelled = true;
      unsub();
    };
  }, [authority, traderPda, dispatch, store]);
}
