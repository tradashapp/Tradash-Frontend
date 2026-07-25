"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  Analytics01Icon,
} from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { MARKETS } from "@/lib/markets";

// Phase 0 shell: the homepage IS the trading screen. This proves the store,
// theme, and Hugeicons wiring end-to-end. Phase 1 replaces the placeholder
// stage with the live chart + dot-grid background; Phase 3 wires the buttons.
export default function TradePage() {
  const activeSymbol = useAppSelector((s) => s.market.active);
  const price = useAppSelector((s) => s.price.prices[activeSymbol]);
  const market = MARKETS[activeSymbol];

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden">
      {/* Header: market + live price */}
      <header className="flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Analytics01Icon} size={20} className="text-up" />
          <span className="text-sm font-medium text-text-muted">
            {market.label}
          </span>
        </div>
        <div className="tabular text-right">
          <div className="text-2xl font-semibold">
            {price != null ? `$${price.toLocaleString()}` : "—"}
          </div>
          <div className="text-xs text-text-muted">{market.bulkSymbol}</div>
        </div>
      </header>

      {/* Chart stage — placeholder until Phase 1 */}
      <section className="relative flex flex-1 items-center justify-center">
        <p className="text-sm text-text-muted">
          Chart + live price land here in Phase 1
        </p>
      </section>

      {/* Trade buttons — wired in Phase 3 */}
      <footer className="grid grid-cols-2 gap-3 px-5 pb-6">
        <button
          type="button"
          disabled
          className="flex items-center justify-center gap-2 rounded-2xl bg-up-soft py-5 text-lg font-semibold text-up transition-transform duration-150 ease-snap active:scale-95 disabled:opacity-60"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={22} />
          UP
        </button>
        <button
          type="button"
          disabled
          className="flex items-center justify-center gap-2 rounded-2xl bg-down-soft py-5 text-lg font-semibold text-down transition-transform duration-150 ease-snap active:scale-95 disabled:opacity-60"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={22} />
          DOWN
        </button>
      </footer>
    </main>
  );
}
