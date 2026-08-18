"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Search01Icon, StarIcon } from "@hugeicons/core-free-icons";
import {
  MARKETS,
  MARKET_CATEGORIES,
  MARKET_ORDER,
  inCategory,
} from "@/lib/markets";
import { formatUsd } from "@/lib/format";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { startSwitch, finishSwitch } from "@/store/slices/marketSlice";
import { toggleFavouriteMarket } from "@/store/slices/settingsSlice";
import type { MarketCategory, MarketSymbol } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Slide-up asset picker. Switching dispatches into the market slice (which the
// chart/price subscriptions react to) without reloading.
export function MarketSwitcher({ open, onClose }: Props) {
  const dispatch = useAppDispatch();
  const active = useAppSelector((s) => s.market.active);
  const prices = useAppSelector((s) => s.price.prices);
  const favourites = useAppSelector((s) => s.settings.favouriteMarkets);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MarketCategory>("all");
  const searchRef = useRef<HTMLInputElement>(null);

  // Reset the filters each time the sheet opens so it never reopens mid-search.
  useEffect(() => {
    if (open) {
      setQuery("");
      setCategory("all");
    }
  }, [open]);

  const favouriteSet = useMemo(() => new Set(favourites), [favourites]);

  // 24h stats from Bulk drive both the "Hot" set and the change column. Only
  // polls while the sheet is open.
  const { stats, hot } = useMarketStats(open);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = MARKET_ORDER.filter((symbol) => {
      const m = MARKETS[symbol];
      const matchesCategory =
        category === "favourites"
          ? favouriteSet.has(symbol)
          : category === "hot"
            ? hot.has(symbol)
            : inCategory(symbol, category);
      if (!matchesCategory) return false;
      if (!q) return true;
      return (
        symbol.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
      );
    });
    // Hot is a ranking, not just a filter — show the biggest movers first.
    if (category === "hot") {
      return rows.sort(
        (a, b) =>
          Math.abs(stats[b]?.changePercent ?? 0) -
          Math.abs(stats[a]?.changePercent ?? 0)
      );
    }
    return rows;
  }, [query, category, favouriteSet, hot, stats]);

  const select = (symbol: MarketSymbol) => {
    if (symbol !== active) {
      dispatch(startSwitch(symbol));
      // Chart resets on symbol change; clear the switching flag next tick.
      requestAnimationFrame(() => dispatch(finishSwitch()));
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="glass fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-3xl p-4 pb-8"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-up" />

            {/* Search + close. The field takes the whole line; close sits far right. */}
            <div className="mb-3 flex shrink-0 items-center gap-2">
              <div className="glass-inset flex min-w-0 flex-1 items-center gap-2 rounded-full px-3.5 py-2.5">
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={18}
                  className="shrink-0 text-text-muted"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search markets"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                    aria-label="Clear search"
                    className="shrink-0 text-text-muted transition-colors hover:text-text"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={16} />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="glass-inset flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-text"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={18} />
              </button>
            </div>

            {/* Category pills — scroll horizontally when they outrun the width. */}
            <div className="scroll-glass -mx-4 mb-3 shrink-0 overflow-x-auto px-4">
              <div className="flex w-max items-center gap-2">
                {MARKET_CATEGORIES.map((c) => {
                  const selected = c.id === category;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCategory(c.id)}
                      className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? "bg-up text-black"
                          : "glass-inset text-text-muted hover:text-text"
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Column headings for the list below. */}
            <div className="mb-2 flex shrink-0 items-center gap-3 px-3 text-[11px] tracking-wide text-text-muted">
              {/* Spacer matches the star + logo so "Market" sits over the name. */}
              {/* <div className="w-[52px] shrink-0" /> */}
              <div className="flex-1">Market</div>
              <div>Last price</div>
            </div>

            {/* Only the list scrolls. A row is ~61px + 4px gap; capped at ~5.5
                rows so the sheet stays a sheet and the half-row hints there's
                more below. On short screens the vh cap wins so the sheet never
                overruns the viewport. */}
            <div className="scroll-glass -mx-1 flex max-h-[min(358px,45vh)] flex-col gap-1 overflow-y-auto px-1">
              {visible.length === 0 && (
                <p className="px-3 py-8 text-center text-sm text-text-muted">
                  {category === "favourites" && !query
                    ? "No favourites yet. Tap a star to add one."
                    : "No markets match that search."}
                </p>
              )}
              {visible.map((symbol) => {
                const m = MARKETS[symbol];
                const price = prices[symbol];
                const selected = symbol === active;
                const favourite = favouriteSet.has(symbol);
                const change = stats[symbol]?.changePercent;
                return (
                  <div
                    key={symbol}
                    className={`flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-white/10 ${
                      selected ? "bg-white/10" : "glass-inset"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => dispatch(toggleFavouriteMarket(symbol))}
                      aria-label={
                        favourite
                          ? `Remove ${m.label} from favourites`
                          : `Add ${m.label} to favourites`
                      }
                      aria-pressed={favourite}
                      className={`shrink-0 transition-colors ${
                        favourite
                          ? "text-[#F5B90A]"
                          : "text-text-muted hover:text-text"
                      }`}
                    >
                      <HugeiconsIcon
                        icon={StarIcon}
                        size={18}
                        fill={favourite ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => select(symbol)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <Image
                        src={m.logo}
                        alt=""
                        width={32}
                        height={32}
                        className="h-8 w-8 shrink-0 rounded-full"
                      />
                      <div className="min-w-0 flex-1 leading-tight">
                        <div className="truncate font-medium">{m.label}</div>
                        <div className="flex items-center gap-1.5 text-xs text-text-muted">
                          <span>{m.symbol}</span>
                          <span className="rounded bg-white/[0.07] px-1 py-px text-[10px] font-medium">
                            {m.maxLeverage}x
                          </span>
                        </div>
                      </div>
                      {/* Live oracle price, with Bulk's 24h change beneath it. */}
                      <div className="shrink-0 text-right leading-tight">
                        <div className="tabular text-sm text-text">
                          {price != null ? formatUsd(price) : "—"}
                        </div>
                        {change != null && (
                          <div
                            className={`tabular text-xs ${
                              change > 0
                                ? "text-up"
                                : change < 0
                                  ? "text-down"
                                  : "text-text-muted"
                            }`}
                          >
                            {change > 0 ? "+" : ""}
                            {change.toFixed(2)}%
                          </div>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
