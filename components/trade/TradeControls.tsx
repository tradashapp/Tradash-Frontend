"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, ArrowDown01Icon, PlusSignIcon, MinusSignIcon } from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { formatPrice, formatUsd } from "@/lib/format";
import { roi } from "@/lib/perp";
import type { Position } from "@/types";

interface Props {
  position: Position | null;
  onLong: () => void;
  onShort: () => void;
  onIncrease: (pct: number) => void;
  onDecrease: (pct: number) => void;
}

// The bottom control cluster. Flat → UP/DOWN. In a position → a slim glass
// detail strip + Increase/Decrease, each opening a quick-pick % popover.
export function TradeControls({
  position,
  onLong,
  onShort,
  onIncrease,
  onDecrease,
}: Props) {
  if (!position) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={onLong}
          className="flex items-center justify-center gap-2 rounded-2xl bg-up-soft py-5 text-lg font-semibold text-up backdrop-blur-sm transition-transform duration-150 ease-snap active:scale-95"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={22} />
          UP
        </button>
        <button
          type="button"
          onClick={onShort}
          className="flex items-center justify-center gap-2 rounded-2xl bg-down-soft py-5 text-lg font-semibold text-down backdrop-blur-sm transition-transform duration-150 ease-snap active:scale-95"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={22} />
          DOWN
        </button>
      </div>
    );
  }

  return <ActivePosition position={position} onIncrease={onIncrease} onDecrease={onDecrease} />;
}

function ActivePosition({
  position,
  onIncrease,
  onDecrease,
}: {
  position: Position;
  onIncrease: (pct: number) => void;
  onDecrease: (pct: number) => void;
}) {
  const currentPrice = useAppSelector((s) => s.price.prices[position.symbol]);
  const [picker, setPicker] = useState<null | "inc" | "dec">(null);
  const isProfit = position.unrealizedPnl >= 0;
  const roiPct = roi(position.unrealizedPnl, position.marginUsed) * 100;

  const pick = (pct: number) => {
    if (picker === "inc") onIncrease(pct);
    else if (picker === "dec") onDecrease(pct);
    setPicker(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Slim glass detail strip — never covers the buttons */}
      <div className="glass flex items-center justify-between rounded-2xl px-4 py-2.5 text-xs">
        <span
          className={`rounded-md px-1.5 py-0.5 font-bold ${
            position.direction === "long" ? "bg-up-soft text-up" : "bg-down-soft text-down"
          }`}
        >
          {position.direction === "long" ? "LONG" : "SHORT"} {position.leverage}×
        </span>
        <Stat label="ROI" value={`${isProfit ? "+" : "−"}${Math.abs(roiPct).toFixed(1)}%`} color={isProfit ? "up" : "down"} />
        <Stat label="Liq" value={`$${formatPrice(position.liquidationPrice)}`} color="down" />
        <Stat label="Margin" value={formatUsd(position.marginUsed)} />
      </div>

      {/* Quick-pick % popover */}
      <AnimatePresence>
        {picker && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="glass grid grid-cols-4 gap-2 rounded-2xl p-2"
          >
            {[
              { label: "25%", pct: 0.25 },
              { label: "50%", pct: 0.5 },
              { label: "100%", pct: 1 },
              { label: "Max", pct: 1 },
            ].map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => pick(c.pct)}
                className="glass-inset rounded-xl py-2.5 text-sm font-semibold transition-colors hover:bg-white/10"
              >
                {c.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Increase / Decrease */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setPicker(picker === "inc" ? null : "inc")}
          className={`flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold text-up backdrop-blur-sm transition-transform active:scale-95 ${
            picker === "inc" ? "bg-up/25" : "bg-up-soft"
          }`}
        >
          <HugeiconsIcon icon={PlusSignIcon} size={20} />
          Increase
        </button>
        <button
          type="button"
          onClick={() => setPicker(picker === "dec" ? null : "dec")}
          className={`flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold text-down backdrop-blur-sm transition-transform active:scale-95 ${
            picker === "dec" ? "bg-down/25" : "bg-down-soft"
          }`}
        >
          <HugeiconsIcon icon={MinusSignIcon} size={20} />
          Decrease
        </button>
      </div>
      {currentPrice == null && null}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "up" | "down";
}) {
  return (
    <div className="text-right leading-tight">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div
        className={`tabular font-semibold ${
          color === "up" ? "text-up" : color === "down" ? "text-down" : "text-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
