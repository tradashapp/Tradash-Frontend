"use client";

import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { MARKETS } from "@/lib/markets";
import { formatUsd } from "@/lib/format";
import { useAppSelector } from "@/store/hooks";
import type { MarketSymbol } from "@/types";

interface Props {
  symbol: MarketSymbol;
  /** Open the asset switcher (Phase 4 sheet). */
  onOpen: () => void;
}

// Top-left market identity: logo + live price + name. The whole block is a
// button that opens the asset switcher.
export function MarketHeader({ symbol, onOpen }: Props) {
  const market = MARKETS[symbol];
  const price = useAppSelector((s) => s.price.prices[symbol]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors bg-bg-overlay/50 hover:bg-bg-overlay"
    >
      <Image
        src={market.logo}
        alt={market.label}
        width={40}
        height={40}
        className="h-10 w-10 rounded-full"
        priority
      />
      <div className="leading-tight">
        <div className="flex items-center gap-1">
          <span className="tabular text-xl font-semibold">
            {price != null ? formatUsd(price) : "—"}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={16}
            className="text-text-muted transition-transform group-hover:translate-y-0.5"
          />
        </div>
        <div className="text-xs text-text-muted">
          {market.symbol} · {market.label}
        </div>
      </div>
    </button>
  );
}
