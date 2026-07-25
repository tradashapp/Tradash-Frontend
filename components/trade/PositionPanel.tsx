"use client";

import { motion } from "framer-motion";
import { useAppSelector } from "@/store/hooks";
import { formatPrice, formatUsd } from "@/lib/format";
import { roi } from "@/lib/perp";
import { PnLCounter } from "./PnLCounter";
import type { Position } from "@/types";

interface Props {
  position: Position;
  onClose: () => void;
}

// Replaces the UP/DOWN buttons once a position is open. Shows the live metrics
// and a Close button. PnL/ROI update continuously from the position slice.
export function PositionPanel({ position, onClose }: Props) {
  const currentPrice = useAppSelector((s) => s.price.prices[position.symbol]);
  const isProfit = position.unrealizedPnl >= 0;
  const roiPct = roi(position.unrealizedPnl, position.marginUsed) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl bg-bg-elevated/80 p-4 backdrop-blur-md"
    >
      {/* PnL headline */}
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="text-xs text-text-muted">Unrealized PnL</div>
          <PnLCounter
            value={position.unrealizedPnl}
            className={`tabular text-3xl font-bold ${
              isProfit ? "text-up" : "text-down"
            }`}
          />
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">ROI</div>
          <div
            className={`tabular text-lg font-semibold ${
              isProfit ? "text-up" : "text-down"
            }`}
          >
            {isProfit ? "+" : "−"}
            {Math.abs(roiPct).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Position badge */}
      <div className="mb-3 flex items-center gap-2 text-sm">
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-bold ${
            position.direction === "long"
              ? "bg-up-soft text-up"
              : "bg-down-soft text-down"
          }`}
        >
          {position.direction === "long" ? "LONG" : "SHORT"} {position.leverage}×
        </span>
        <span className="text-text-muted">{position.symbol}</span>
      </div>

      {/* Metrics grid */}
      <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Metric label="Entry" value={`$${formatPrice(position.entryPrice)}`} />
        <Metric
          label="Current"
          value={currentPrice != null ? `$${formatPrice(currentPrice)}` : "—"}
        />
        <Metric
          label="Liquidation"
          value={`$${formatPrice(position.liquidationPrice)}`}
          danger
        />
        <Metric label="Margin" value={formatUsd(position.marginUsed)} />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-2xl bg-white/10 py-4 text-lg font-semibold text-text transition-transform active:scale-95"
      >
        Close position
      </button>
    </motion.div>
  );
}

function Metric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className={`tabular ${danger ? "text-down" : "text-text"}`}>
        {value}
      </span>
    </div>
  );
}
