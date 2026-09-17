"use client";

import { useCallback } from "react";
import { MARKETS } from "@/lib/markets";
import { fetchAccount } from "@/lib/bulk/client";
import {
  cancelProtection,
  findStopLoss,
  findTakeProfit,
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
   * Trailing distance in basis points. When set it REPLACES the plain stop:
   * both occupy the same downside slot, and Bulk would otherwise rest two
   * competing stops on one position.
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
        const wantTp = takeProfit != null;
        const wantTrail = trailBps != null && trailBps > 0;
        const wantSl = !wantTrail && stopLoss != null;

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
        } else if (wantSl) {
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
          const slOk = (wantTrail || wantSl) === (findStopLoss(orders) != null);
          return tpOk && slOk;
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

  return { setProtection, clearProtection };
}
