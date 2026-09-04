"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  Alert02Icon,
  Loading03Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { MARKETS, MARKET_ORDER, maxLeverageFor } from "@/lib/markets";
import { haptic } from "@/lib/haptics";
import type { useLeverage } from "@/hooks/useLeverage";
import type { MarketSymbol } from "@/types";

// Per-market leverage. Every market has its OWN ceiling on Bulk (BTC 40×, ETH
// 25×, most alts 10×), so this is a list of markets rather than one number —
// and each row's scale is drawn against that market's own cap, so "half way"
// always means the same thing about risk even though the numbers differ.
//
// A row collapses to the essentials (asset, current ×, a risk bar) and expands
// on tap into the slider, so 16+ markets stay scannable in a phone sheet.

/** Risk tiers, as a fraction of the market's own maximum. */
function riskOf(leverage: number, max: number): {
  label: string;
  tone: string;
  bar: string;
} {
  const t = leverage / max;
  if (t <= 0.25) return { label: "Low", tone: "text-up", bar: "bg-up" };
  if (t <= 0.6)
    return { label: "Medium", tone: "text-[#F5B90A]", bar: "bg-[#F5B90A]" };
  return { label: "High", tone: "text-down", bar: "bg-down" };
}

/** How far price can move against the position before liquidation, roughly. */
const liqDistance = (leverage: number) => 100 / leverage;

/** Four handy stops for a market: 1×, and thirds of its own cap. */
function presetsFor(max: number): number[] {
  const stops = [1, Math.round(max / 4), Math.round(max / 2), max];
  return [...new Set(stops.filter((n) => n >= 1 && n <= max))];
}

export function LeverageSettings({
  leverage,
}: {
  leverage: ReturnType<typeof useLeverage>;
}) {
  const { leverageOf, byMarket, sync, setLeverage, canSync } = leverage;
  const [expanded, setExpanded] = useState<MarketSymbol | null>(null);
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MARKET_ORDER;
    return MARKET_ORDER.filter(
      (s) =>
        s.toLowerCase().includes(q) ||
        MARKETS[s].label.toLowerCase().includes(q)
    );
  }, [query]);

  // Markets the user has actually changed — surfaced as a count so it's obvious
  // at a glance whether anything is customised without opening every row.
  const customised = Object.keys(byMarket).length;

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <h3 className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Leverage
        </h3>
        {customised > 0 && (
          <span className="text-[11px] text-text-muted">
            {customised} customised
          </span>
        )}
      </div>

      {/* Where the numbers actually land. Leverage lives on the Bulk account per
          market, so in demo (or before setup) a change is only a local promise —
          say so instead of showing a sync state that never resolves. */}
      {!canSync && (
        <div className="mb-2 flex items-start gap-2 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[11px] leading-snug text-text-muted">
          <HugeiconsIcon
            icon={Alert02Icon}
            size={14}
            className="mt-px shrink-0"
          />
          <span>
            Saved on this device. Finish setup and switch to live to apply these
            on your trading account.
          </span>
        </div>
      )}

      {/* Search earns its place at 16+ markets — the list is long enough that
          scrolling to one asset is the slow path. */}
      <div className="glass-inset mb-2 flex items-center gap-2 rounded-xl px-3 py-2">
        <HugeiconsIcon
          icon={Search01Icon}
          size={16}
          className="shrink-0 text-text-muted"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a market"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
        />
      </div>

      <div className="glass-inset overflow-hidden rounded-2xl">
        <div className="divide-y divide-white/[0.06]">
          {visible.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">
              No markets match that search.
            </p>
          )}
          {visible.map((symbol) => (
            <LeverageRow
              key={symbol}
              symbol={symbol}
              value={leverageOf(symbol)}
              custom={byMarket[symbol] != null}
              state={sync[symbol]}
              open={expanded === symbol}
              onToggle={() =>
                setExpanded((cur) => (cur === symbol ? null : symbol))
              }
              onChange={(v) => setLeverage(symbol, v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function LeverageRow({
  symbol,
  value,
  custom,
  state,
  open,
  onToggle,
  onChange,
}: {
  symbol: MarketSymbol;
  value: number;
  custom: boolean;
  state: "idle" | "syncing" | "synced" | "error" | "local" | undefined;
  open: boolean;
  onToggle: () => void;
  onChange: (v: number) => void;
}) {
  const m = MARKETS[symbol];
  const max = maxLeverageFor(symbol);
  const risk = riskOf(value, max);
  const pct = (value / max) * 100;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          haptic("tap");
          onToggle();
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <Image
          src={m.logo}
          alt=""
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 rounded-full"
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{m.symbol}</span>
            {custom && (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-up" />
            )}
          </div>
          {/* The bar reads risk at a glance: filled against THIS market's cap,
              so a 10× on a 10× market looks as hot as 40× on BTC — which is
              exactly how the margin behaves. */}
          <div className="mt-1.5 h-1 w-full max-w-[120px] overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-300 ${risk.bar}`}
              style={{ width: `${Math.max(pct, 4)}%` }}
            />
          </div>
        </div>
        <SyncBadge state={state} />
        <div className="shrink-0 text-right leading-tight">
          <div className="tabular text-sm font-semibold text-text">
            {value}×
          </div>
          <div className={`text-[10px] font-medium ${risk.tone}`}>
            {risk.label}
          </div>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="editor"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs text-text-muted">
                  Liquidates on a{" "}
                  <span className="tabular text-text">
                    {liqDistance(value).toFixed(1)}%
                  </span>{" "}
                  move against you
                </span>
                <span className="tabular text-[11px] text-text-muted">
                  max {max}×
                </span>
              </div>

              <input
                type="range"
                min={1}
                max={max}
                step={1}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                aria-label={`${m.label} leverage`}
                className="lev-slider w-full"
                style={{
                  // Fill the track up to the thumb so the slider itself shows
                  // how much of this market's range is being used.
                  ["--fill" as string]: `${((value - 1) / Math.max(max - 1, 1)) * 100}%`,
                }}
              />

              <div className="mt-2 flex items-center gap-2">
                {presetsFor(max).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      haptic("tap");
                      onChange(p);
                    }}
                    className={`tabular flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                      value === p
                        ? "bg-up text-black"
                        : "bg-white/[0.07] text-text-muted hover:bg-white/10"
                    }`}
                  >
                    {p}×
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Whether this market's leverage has reached the Bulk account yet. */
function SyncBadge({
  state,
}: {
  state: "idle" | "syncing" | "synced" | "error" | "local" | undefined;
}) {
  if (state === "syncing") {
    return (
      <HugeiconsIcon
        icon={Loading03Icon}
        size={14}
        className="shrink-0 animate-spin text-text-muted"
        aria-label="Applying"
      />
    );
  }
  if (state === "synced") {
    return (
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        size={14}
        className="shrink-0 text-up"
        aria-label="Applied to your account"
      />
    );
  }
  if (state === "error") {
    return (
      <HugeiconsIcon
        icon={Alert02Icon}
        size={14}
        className="shrink-0 text-down"
        aria-label="Not applied"
      />
    );
  }
  return null;
}
