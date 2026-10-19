"use client";

import { useCallback } from "react";
import { MARKETS } from "@/lib/markets";
import { fetchAccount } from "@/lib/bulk/client";
import {
  cancelProtection,
  findStopLoss,
  findTakeProfit,
  findTrailingStop,
  readProtection,
  stopLossOrder,
  submitProtection,
  takeProfitOrder,
  trailingStopOrder,
} from "@/lib/bulk/protection";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { patchPosition } from "@/store/slices/positionSlice";
import { useToast } from "@/components/toast/ToastProvider";
import type { AgentSigner } from "@/lib/bulk/signing";
import type { Direction, MarketSymbol, ProtectionOrder } from "@/types";

/**
 * Place, replace and cancel the protective triggers (TP / SL / trailing) that
 * rest on Bulk against an open position.
 *
 * Every write ends with a READ-BACK, and that is the point of this hook. Bulk
 * acknowledges a malformed trigger with `{"resting":{"oid":...}}` — a real
 * order id — and then silently discards it: no error, nothing in
 * `protection.orders`, and a user who believes their stop is armed. So an ack
 * is never treated as success here; the account is re-read and the order must
 * actually be there. See lib/bulk/protection.ts for the direction rule that
 * causes the discard.
 */

/** How long to keep re-reading before calling a placement unverified. */
const VERIFY_ATTEMPTS = 4;
const VERIFY_DELAY_MS = 700;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface SetProtectionParams {
  symbol: MarketSymbol;
  direction: Direction;
  /** Base-asset size to close — normally the whole position. */
  size: number;
  /** Trigger price, in Bulk's price space. Null leaves this side unset. */
  takeProfit: number | null;
  stopLoss: number | null;
  /**
   * Trailing distance in basis points. Independent of `stopLoss` — a position
   * can carry both a fixed floor and a ratcheting one, and whichever price
   * reaches first closes it.
   */
  trailBps?: number | null;
}

export function useProtection(signer: AgentSigner | null) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const walletAddress = useAppSelector((s) => s.user.walletAddress);

  /**
   * Re-read this position's resting orders from Bulk.
   *
   * Reads `fullAccount` rather than `openOrders` because protection is nested
   * per position there, so a multi-market account cannot mix up whose stop is
   * whose.
   */
  const readBack = useCallback(
    async (symbol: MarketSymbol): Promise<ProtectionOrder[]> => {
      if (!walletAddress) return [];
      const acct = await fetchAccount(walletAddress).catch(() => null);
      const bulkSymbol = MARKETS[symbol].bulkSymbol;
      const row = acct?.positions?.find((p) => p.symbol === bulkSymbol);
      return readProtection(row?.protection?.orders);
    },
    [walletAddress]
  );

  /** Poll the read-back until `want` is satisfied, or give up. */
  const verify = useCallback(
    async (
      symbol: MarketSymbol,
      want: (orders: ProtectionOrder[]) => boolean
    ): Promise<ProtectionOrder[] | null> => {
      for (let i = 0; i < VERIFY_ATTEMPTS; i++) {
        await sleep(VERIFY_DELAY_MS);
        const orders = await readBack(symbol);
        if (want(orders)) {
          // Push the confirmed truth into the store so the row updates without
          // waiting for the next WS snapshot.
          dispatch(patchPosition({ symbol, patch: { protection: orders } }));
          return orders;
        }
      }
      return null;
    },
    [readBack, dispatch]
  );

  /**
   * Apply a full TP/SL intent to a position: cancels whatever rests today and
   * places what the user asked for.
   *
   * Cancel-then-place (rather than place-then-cancel) because Bulk rests both
   * happily, and a moment with two take-profits on one position could close it
   * twice on a fast move. A moment with none is the safer failure.
   */
  const setProtection = useCallback(
    async ({
      symbol,
      direction,
      size,
      takeProfit,
      stopLoss,
      trailBps,
    }: SetProtectionParams): Promise<boolean> => {
      if (!signer) {
        toast("Connect your wallet to set TP/SL", { type: "error" });
        return false;
      }
      const bulkSymbol = MARKETS[symbol].bulkSymbol;
      const id = `tpsl-${symbol}`;
      toast("Updating TP/SL…", { type: "loading", id });

      try {
        // 1. Clear what is resting now. A stale level left behind would fire
        //    against the user's new intent.
        const existing = await readBack(symbol);
        for (const o of existing) {
          await cancelProtection(signer, bulkSymbol, o.orderId).catch(() => {
            // A cancel can lose a race with a fill; the verify below is what
            // decides whether the end state is right.
          });
        }

        // 2. Place the requested sides.
        // All three are INDEPENDENT. Bulk rests a take-profit, a fixed stop and
        // a trailing stop on one position simultaneously (verified live
        // 2026-09-18), and when two same-side stops both trigger it fills only
        // one — the position closed exactly once, with no flip. So a trail no
        // longer suppresses the fixed stop.
        const wantTp = takeProfit != null;
        const wantTrail = trailBps != null && trailBps > 0;
        const wantSl = stopLoss != null;

        if (wantTp) {
          await submitProtection(
            signer,
            takeProfitOrder({
              bulkSymbol,
              direction,
              size,
              triggerPrice: takeProfit,
            })
          );
        }
        if (wantTrail) {
          await submitProtection(
            signer,
            trailingStopOrder({
              bulkSymbol,
              direction,
              size,
              trailBps,
              // Ratchet as finely as the trail allows, capped so a tight trail
              // does not rewrite the resting order on every tick.
              stepBps: Math.max(1, Math.min(10, Math.round(trailBps / 10))),
            })
          );
        }
        if (wantSl) {
          await submitProtection(
            signer,
            stopLossOrder({
              bulkSymbol,
              direction,
              size,
              triggerPrice: stopLoss,
            })
          );
        }

        // 3. Verify. An ack is not evidence — only the read-back is.
        const ok = await verify(symbol, (orders) => {
          const tpOk = wantTp === (findTakeProfit(orders) != null);
          const slOk = wantSl === (findStopLoss(orders) != null);
          const trailOk = wantTrail === (findTrailingStop(orders) != null);
          return tpOk && slOk && trailOk;
        });

        if (!ok) {
          toast("Couldn't confirm TP/SL", {
            type: "error",
            id,
            description:
              "Bulk accepted the order but it isn't resting. Nothing is " +
              "protecting this position — please try again.",
          });
          return false;
        }

        const cleared = !wantTp && !wantSl && !wantTrail;
        toast(cleared ? "TP/SL cleared" : "TP/SL updated", {
          type: "success",
          id,
        });
        return true;
      } catch (e) {
        toast("Couldn't set TP/SL", {
          type: "error",
          id,
          description: e instanceof Error ? e.message : undefined,
        });
        return false;
      }
    },
    [signer, toast, readBack, verify]
  );

  /**
   * Re-size a position's resting triggers after its SIZE changed (add/reduce).
   *
   * Every trigger carries an explicit size — Bulk drops `reduceOnly` on write
   * (see lib/bulk/protection.ts) — so after an add, a TP/SL/trail still sized
   * to the old position closes only PART of it, and after a reduce it is
   * oversized. Since these orders fire server-side with the app closed, that
   * mismatch is exactly when nobody is watching. So the fill is followed by
   * cancel + re-place at the new size, keeping every level where it was.
   *
   * Bulk's position size lags the fill slightly, so it polls until the size
   * moves off `prevSize`. A flat result is left alone: the close paths already
   * cancel protection for a position that no longer exists.
   *
   * CAVEAT: a re-placed trail restarts its high-water mark at the current
   * price. Unavoidable — Bulk has no way to edit a resting `trl` in place.
   */
  const resizeProtection = useCallback(
    async (
      symbol: MarketSymbol,
      prevSize: number,
      /** Used only if Bulk's read-back omits the trail's `trb`. */
      fallbackTrailBps: number
    ): Promise<void> => {
      if (!signer || !walletAddress) return;
      const bulkSymbol = MARKETS[symbol].bulkSymbol;
      for (let i = 0; i < VERIFY_ATTEMPTS; i++) {
        await sleep(VERIFY_DELAY_MS);
        const acct = await fetchAccount(walletAddress).catch(() => null);
        const row = acct?.positions?.find((p) => p.symbol === bulkSymbol);
        if (!row || row.size === 0) return;
        const size = Math.abs(row.size);
        // Not reflected yet — keep waiting rather than re-placing at the old size.
        if (Math.abs(size - prevSize) <= prevSize * 1e-9) continue;
        const orders = readProtection(row.protection?.orders);
        if (orders.length === 0) return;
        const trail = findTrailingStop(orders);
        await setProtection({
          symbol,
          direction: row.size > 0 ? "long" : "short",
          size,
          takeProfit: findTakeProfit(orders)?.triggerPrice ?? null,
          stopLoss: findStopLoss(orders)?.triggerPrice ?? null,
          trailBps: trail ? (trail.trailBps ?? fallbackTrailBps) : null,
        });
        return;
      }
    },
    [signer, walletAddress, setProtection]
  );

  /**
   * A signal trade's exits: ONE stop for the whole position and one
   * take-profit per leg, each sized explicitly (Bulk drops `reduceOnly` on
   * tp/st, so a leg must carry its own share or it would close too much).
   * Same cancel → place → verify discipline as setProtection; verified by
   * counting that every leg and the stop are resting.
   */
  const setScaleOut = useCallback(
    async ({
      symbol,
      direction,
      stopLoss,
      stopSize,
      legs,
    }: {
      symbol: MarketSymbol;
      direction: Direction;
      stopLoss: number;
      stopSize: number;
      legs: Array<{ price: number; size: number }>;
    }): Promise<boolean> => {
      if (!signer) {
        toast("Connect your wallet to set TP/SL", { type: "error" });
        return false;
      }
      const bulkSymbol = MARKETS[symbol].bulkSymbol;
      const id = `tpsl-${symbol}`;
      toast("Setting stop and targets…", { type: "loading", id });
      try {
        for (const o of await readBack(symbol)) {
          await cancelProtection(signer, bulkSymbol, o.orderId).catch(() => undefined);
        }
        await submitProtection(signer, stopLossOrder({ bulkSymbol, direction, size: stopSize, triggerPrice: stopLoss }));
        for (const leg of legs.filter((l) => l.size > 0)) {
          await submitProtection(signer, takeProfitOrder({ bulkSymbol, direction, size: leg.size, triggerPrice: leg.price }));
        }
        const wantTps = legs.filter((l) => l.size > 0).length;
        const ok = await verify(
          symbol,
          (orders) => findStopLoss(orders) != null && orders.filter((o) => o.kind === "takeProfit").length === wantTps
        );
        if (!ok) {
          toast("Couldn't confirm stop and targets", {
            type: "error",
            id,
            description: "Bulk accepted the orders but they aren't all resting. Check the position's TP/SL.",
          });
          return false;
        }
        toast("Stop and targets set", { type: "success", id });
        return true;
      } catch (e) {
        toast("Couldn't set stop and targets", { type: "error", id, description: e instanceof Error ? e.message : undefined });
        return false;
      }
    },
    [signer, toast, readBack, verify]
  );

  /** Remove every resting trigger from a position. */
  const clearProtection = useCallback(
    (symbol: MarketSymbol, direction: Direction, size: number) =>
      setProtection({
        symbol,
        direction,
        size,
        takeProfit: null,
        stopLoss: null,
        trailBps: null,
      }),
    [setProtection]
  );

  return { setProtection, setScaleOut, clearProtection, resizeProtection };
}
