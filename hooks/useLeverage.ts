"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMarketLeverage } from "@/store/slices/settingsSlice";
import { venue } from "@/lib/venue";
import { clampLeverage, leverageFor } from "@/lib/markets";
import { useToast } from "@/components/toast/ToastProvider";
import type { AgentSigner } from "@/lib/bulk/signing";
import type { MarketSymbol } from "@/types";

/** Per-market sync state, so a row can show pending/failed without a toast storm. */
export type LeverageSync = "idle" | "syncing" | "synced" | "error" | "local";

// Settling time after the last drag before we talk to the venue. Dragging a
// slider fires dozens of changes; on Bulk each one is a signed network
// round-trip, so only the value the user LANDS on is pushed.
const PUSH_DEBOUNCE_MS = 600;

/**
 * Per-market leverage: local (instant, persisted) + the venue, where it applies.
 *
 * ## The two venues model leverage differently, and that is not a bug
 *
 * **Bulk** stores leverage per symbol ON THE ACCOUNT and margins every fill
 * with it, so the local number is only a promise until `updateUserSettings`
 * lands — the UI says "syncing" until it does.
 *
 * **Phoenix has no such setting.** Max leverage comes from PROTOCOL SIZE TIERS
 * (SOL: 25x up to 321,646 SOL) and margin is derived from position size; the
 * trader state carries `initialMargin`/`maintenanceMargin` and **no leverage
 * field at all** [LIVE]. There is nothing to push, so `venue.setLeverage`
 * returns `false` and the value stays local — where it still does real work,
 * because `useTrade` sizes orders from it.
 *
 * This used to call Bulk's `setMarketLeverage` unconditionally. On Phoenix the
 * signer is a Solana keypair with no `signPrepared`, so every change raised
 * *"signer.signPrepared is not a function"* — a venue mismatch surfacing as a
 * missing method. Routing through the venue seam is what makes the difference
 * explicit rather than accidental.
 *
 * In demo mode, or before onboarding, there is no account to push to either, so
 * changes are marked "local".
 */
/**
 * Bulk stores leverage per market; Phoenix derives it from size tiers.
 *
 * Read once at module scope — the venue is fixed for the session by
 * `NEXT_PUBLIC_VENUE`, so this cannot change under a running hook.
 */
const venueSupportsLeverage = venue.id !== "phoenix";

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
        const applied = await venue.setLeverage(
          signer as never,
          symbol,
          leverage
        );
        // `false` means the venue has no leverage setting (Phoenix). That is
        // "not applicable", never a failure — the local value is authoritative
        // for order sizing, so showing an error here would be a lie.
        setSync((s) => ({ ...s, [symbol]: applied ? "synced" : "local" }));
      } catch (e) {
        setSync((s) => ({ ...s, [symbol]: "error" }));
        const msg = e instanceof Error ? e.message : "Could not set leverage";
        toast(`${symbol} leverage not applied`, {
          type: "error",
          id: `lev-${symbol}`,
          description: msg.replace(/^(Bulk|Phoenix) order error:\s*/, ""),
        });
      }
    },
    [signer, toast]
  );

  /** Set a market's leverage. Applies locally at once, syncs to the venue after a beat. */
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
    /**
     * True once the account can actually receive leverage changes.
     *
     * Always FALSE on Phoenix: the venue has no per-market leverage setting, so
     * there is no state for onboarding to unlock. A UI prompting the user to
     * "finish setup to apply this" would be telling them to do something that
     * changes nothing.
     */
    canSync: venueSupportsLeverage && mode === "live" && signer !== null,
    /**
     * Does this venue model leverage as an account setting at all?
     *
     * Distinguishes "not set up yet" (Bulk, fixable) from "this venue has no
     * such concept" (Phoenix, permanent) so the UI can say which.
     */
    venueSupportsLeverage,
  };
}
