"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import { formatUsd } from "@/lib/format";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { startSwitch, finishSwitch } from "@/store/slices/marketSlice";
import type { MarketSymbol } from "@/types";

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
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-bg-elevated p-4 pb-8"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
            <h2 className="mb-3 px-2 text-sm font-medium text-text-muted">
              Select market
            </h2>
            <div className="flex flex-col gap-1">
              {MARKET_ORDER.map((symbol) => {
                const m = MARKETS[symbol];
                const price = prices[symbol];
                const selected = symbol === active;
                return (
                  <button
                    key={symbol}
                    type="button"
                    onClick={() => select(symbol)}
                    className="flex items-center gap-3 rounded-2xl px-3 py-3 transition-colors bg-bg-overlay hover:bg-bg-overlay"
                  >
                    <Image
                      src={m.logo}
                      alt={m.label}
                      width={36}
                      height={36}
                      className="h-9 w-9 rounded-full"
                    />
                    <div className="flex-1 text-left leading-tight">
                      <div className="font-medium">{m.label}</div>
                      <div className="text-xs text-text-muted">{m.symbol}</div>
                    </div>
                    <div className="tabular text-sm text-text">
                      {price != null ? formatUsd(price) : "—"}
                    </div>
                    {selected && (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={18}
                        className="text-up"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
