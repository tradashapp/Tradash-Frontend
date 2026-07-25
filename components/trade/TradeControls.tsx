"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  ArrowMoveUpRightIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { formatPrice, formatUsd } from "@/lib/format";
import { roi } from "@/lib/perp";
import type { Position } from "@/types";

interface Props {
  position: Position | null;
  trailActive: boolean;
  trailEligible: boolean;
  trailPct: number;
  onLong: () => void;
  onShort: () => void;
  onToggleTrail: () => void;
  onClose: () => void;
}

// Bottom control cluster. Flat → UP/DOWN. In a position → slim glass detail
// strip + Trail (lock profits) / Close (100%).
export function TradeControls({
  position,
  trailActive,
  trailEligible,
  trailPct,
  onLong,
  onShort,
  onToggleTrail,
  onClose,
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

  return (
    <ActivePosition
      position={position}
      trailActive={trailActive}
      trailEligible={trailEligible}
      trailPct={trailPct}
      onToggleTrail={onToggleTrail}
      onClose={onClose}
    />
  );
}

function ActivePosition({
  position,
  trailActive,
  trailEligible,
  trailPct,
  onToggleTrail,
  onClose,
}: {
  position: Position;
  trailActive: boolean;
  trailEligible: boolean;
  trailPct: number;
  onToggleTrail: () => void;
  onClose: () => void;
}) {
  const isProfit = position.unrealizedPnl >= 0;
  const roiPct = roi(position.unrealizedPnl, position.marginUsed) * 100;

  return (
    <div className="flex flex-col gap-2">
      {/* Slim glass detail strip — never covers the buttons */}
      <div className="glass flex items-center justify-between rounded-2xl px-4 py-2.5 text-xs">
        <span
          className={`rounded-md px-1.5 py-0.5 font-bold ${
            position.direction === "long"
              ? "bg-up-soft text-up"
              : "bg-down-soft text-down"
          }`}
        >
          {position.direction === "long" ? "LONG" : "SHORT"} {position.leverage}×
        </span>
        <Stat
          label="ROI"
          value={`${isProfit ? "+" : "−"}${Math.abs(roiPct).toFixed(1)}%`}
          color={isProfit ? "up" : "down"}
        />
        <Stat
          label="Liq"
          value={`$${formatPrice(position.liquidationPrice)}`}
          color="down"
        />
        <Stat label="Margin" value={formatUsd(position.marginUsed)} />
      </div>

      {/* Trail (lock profits) / Close (100%) */}
      {/* Trail can only be armed once in enough profit that the stop lands above
          entry — otherwise it would lock a loss. Disabled + hint until then. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={onToggleTrail}
            disabled={!trailActive && !trailEligible}
            className={`flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-semibold backdrop-blur-sm transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
              trailActive ? "bg-up text-black" : "bg-up-soft text-up"
            }`}
          >
            <HugeiconsIcon icon={ArrowMoveUpRightIcon} size={20} />
            {trailActive ? "Trailing" : "Trail"}
          </button>
          {!trailActive && !trailEligible && (
            <span className="mt-1 text-center text-[10px] text-text-muted">
              Need +{(trailPct * 100).toFixed(trailPct < 0.01 ? 1 : 0)}% to trail
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center gap-2 self-start rounded-2xl bg-white/10 py-4 text-base font-semibold text-text backdrop-blur-sm transition-transform active:scale-95"
          style={{ width: "100%" }}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={20} />
          Close
        </button>
      </div>
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
          color === "up"
            ? "text-up"
            : color === "down"
              ? "text-down"
              : "text-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
