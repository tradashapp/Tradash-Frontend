"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMarketLeverage } from "@/store/slices/settingsSlice";
import { setMarketLeverage as pushLeverageToBulk } from "@/lib/bulk/leverage";
import { MARKETS, clampLeverage, leverageFor } from "@/lib/markets";
import { useToast } from "@/components/toast/ToastProvider";
import type { AgentSigner } from "@/lib/bulk/signing";
import type { MarketSymbol } from "@/types";

/** Per-market sync state, so a row can show pending/failed without a toast storm. */
export type LeverageSync = "idle" | "syncing" | "synced" | "error" | "local";

// Settling time after the last drag before we talk to Bulk. Dragging a slider
// fires dozens of changes; each one is a signed network round-trip, so only the
// value the user LANDS on is pushed.
const PUSH_DEBOUNCE_MS = 600;

/**
 * Per-market leverage: local (instant, persisted) + Bulk (authoritative).
 *
 * Leverage is NOT carried on an order — Bulk stores it per symbol on the
 * account and margins every fill with it. So the local number is only a
 * promise until `updateUserSettings` lands; until then the UI says so rather
 * than pretending. In demo mode (or before onboarding) there's no account to
 * push to, so changes stay local and are marked as such.
 */
export function useLeverage(signer: AgentSigner | null) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const byMarket = useAppSelector((s) => s.settings.leverageByMarket);

  const [sync, setSync] = useState<Partial<Record<MarketSymbol, LeverageSync>>>(
    {}
  );

  // One pending push per market, plus the value each timer should send. Keyed
  // by market so changing BTC never cancels an in-flight SOL push.
  const timers = useRef<Partial<Record<MarketSymbol, ReturnType<typeof setTimeout>>>>({});
  const pending = useRef<Partial<Record<MarketSymbol, number>>>({});

  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const id of Object.values(t)) if (id) clearTimeout(id);
    };
  }, []);

  const flush = useCallback(
    async (symbol: MarketSymbol) => {
      const leverage = pending.current[symbol];
      delete pending.current[symbol];
      delete timers.current[symbol];
      if (leverage == null || !signer) return;
      setSync((s) => ({ ...s, [symbol]: "syncing" }));
      try {
        await pushLeverageToBulk(signer, MARKETS[symbol].bulkSymbol, leverage);
        setSync((s) => ({ ...s, [symbol]: "synced" }));
      } catch (e) {
        setSync((s) => ({ ...s, [symbol]: "error" }));
        const msg = e instanceof Error ? e.message : "Could not set leverage";
        toast(`${symbol} leverage not applied`, {
          type: "error",
          id: `lev-${symbol}`,
          description: msg.replace(/^Bulk order error:\s*/, ""),
        });
      }
    },
    [signer, toast]
  );

  /** Set a market's leverage. Applies locally at once, syncs to Bulk after a beat. */
  const setLeverage = useCallback(
    (symbol: MarketSymbol, raw: number) => {
      const leverage = clampLeverage(symbol, raw);
      dispatch(setMarketLeverage({ symbol, leverage }));

      // Demo, or live-but-not-onboarded: nothing to push to. Say "local" rather
      // than showing a sync state that will never resolve.
      if (mode === "demo" || !signer) {
        setSync((s) => ({ ...s, [symbol]: "local" }));
        return;
      }

      pending.current[symbol] = leverage;
      setSync((s) => ({ ...s, [symbol]: "syncing" }));
      const existing = timers.current[symbol];
      if (existing) clearTimeout(existing);
      timers.current[symbol] = setTimeout(() => {
        void flush(symbol);
      }, PUSH_DEBOUNCE_MS);
    },
    [dispatch, mode, signer, flush]
  );

  return {
    /** Resolved leverage for a market (user's choice or default, clamped). */
    leverageOf: useCallback(
      (symbol: MarketSymbol) => leverageFor(symbol, byMarket),
      [byMarket]
    ),
    /** Markets the user has explicitly set, for "customised" affordances. */
    byMarket,
    sync,
    setLeverage,
    /** True once the account can actually receive leverage changes. */
    canSync: mode === "live" && signer !== null,
  };
}
