"use client";

import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  ArrowDownRight01Icon,
  ArrowRight01Icon,
  ArrowMoveUpRightIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { roi } from "@/lib/perp";
import { useAllPositions } from "@/hooks/useAllPositions";
import { Odometer } from "@/components/ui/Odometer";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
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
  /**
   * Mobile only: open the market settings sheet (which carries the positions
   * list). When provided, a "View positions" pill is shown above the trade
   * buttons WHENEVER ANY position is open — including ones on other markets.
   * Desktop omits it (the right panel already shows the full positions view),
   * so the pill isn't rendered there.
   */
  onViewPositions?: () => void;
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
  onViewPositions,
}: Props) {
  // Positions across EVERY market, not just the one on screen. The pill used to
  // live inside the "in a position" branch, which meant a user holding ETH
  // while looking at the BTC chart had no way back to their own position — the
  // sheet it opens has always listed every market.
  const { items, totalPnl, totalMargin } = useAllPositions();
  const anyOpen = items.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {onViewPositions && anyOpen && (
        <ViewPositionsPill
          count={items.length}
          totalPnl={totalPnl}
          totalMargin={totalMargin}
          onClick={onViewPositions}
        />
      )}

      <AnimatePresence mode="wait" initial={false}>
      {!position ? (
        <motion.div
          key="flat"
          className="grid grid-cols-2 gap-3"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <button
            type="button"
            onClick={onLong}
            className="flex items-center justify-center gap-2 rounded-full bg-up-soft py-5 text-lg font-semibold text-up backdrop-blur-sm transition-transform duration-150 ease-snap active:scale-95 tracking-widest"
          >
            <HugeiconsIcon icon={ArrowUp01Icon} size={22} />
            UP
          </button>
          <button
            type="button"
            onClick={onShort}
            className="flex items-center justify-center gap-2 rounded-full bg-down-soft py-5 text-lg font-semibold text-down backdrop-blur-sm transition-transform duration-150 ease-snap active:scale-95 tracking-widest"
          >
            <HugeiconsIcon icon={ArrowDown01Icon} size={22} />
            DOWN
          </button>
        </motion.div>
      ) : (
        <motion.div
          key="active"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <ActivePosition
            position={position}
            trailActive={trailActive}
            trailEligible={trailEligible}
            trailPct={trailPct}
            onToggleTrail={onToggleTrail}
            onClose={onClose}
          />
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The "View positions" pill, shown above the trade buttons whenever anything is
 * open anywhere. Summarises the WHOLE book (count + aggregate ROI) rather than
 * one position, because it can now appear while the user is looking at a market
 * they hold nothing on — a single position's ROI would be a number with no
 * visible referent.
 */
function ViewPositionsPill({
  count,
  totalPnl,
  totalMargin,
  onClick,
}: {
  count: number;
  totalPnl: number;
  totalMargin: number;
  onClick: () => void;
}) {
  const isProfit = totalPnl >= 0;
  const roiPct = totalMargin > 0 ? (totalPnl / totalMargin) * 100 : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-inset flex items-center gap-3 rounded-full px-4 py-3 text-left transition-colors active:scale-[0.99]"
    >
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full ${
          isProfit ? "bg-up-soft text-up" : "bg-down-soft text-down"
        }`}
      >
        <HugeiconsIcon
          icon={isProfit ? ArrowUpRight01Icon : ArrowDownRight01Icon}
          size={16}
        />
      </span>
      <span className="text-sm font-semibold">
        {count === 1 ? "View position" : `View ${count} positions`}
      </span>
      <span
        className={`ml-1 text-sm font-bold ${isProfit ? "text-up" : "text-down"}`}
      >
        <Odometer
          value={`${isProfit ? "+" : "−"}${Math.abs(roiPct).toFixed(1)}%`}
        />
      </span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={18}
        className="ml-auto text-text-muted"
      />
    </button>
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
  return (
    <div className="flex flex-col gap-2">

      {/* Trail (lock profits) / Close (100%) */}
      {/* Trail can only be armed once in enough profit that the stop lands above
          entry — otherwise it would lock a loss. Disabled + hint until then. */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col">
          <button
            type="button"
            onClick={() => {
              playSound("tap");
              haptic("tap");
              onToggleTrail();
            }}
            disabled={!trailActive && !trailEligible}
            className={`flex items-center justify-center gap-2 rounded-full py-4 text-base font-semibold backdrop-blur-sm transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 tracking-widest uppercase ${
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
          {/* Trailing runs client-side, so it only watches price while the app
              is open. Small honest note so users aren't misled (server-side
              always-on keeper is a separate, planned project). */}
          {trailActive && (
            <span className="mt-1 text-center text-[10px] text-text-muted">
              Active only while app is open
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center gap-2 self-start rounded-full bg-down-soft py-4 text-base font-semibold text-down backdrop-blur-sm transition-transform active:scale-95 tracking-widest uppercase"
          style={{ width: "100%" }}
        >
          <HugeiconsIcon icon={Cancel01Icon} size={20} />
          Close
        </button>
      </div>
    </div>
  );
}

