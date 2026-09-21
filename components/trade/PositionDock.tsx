"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Coins01Icon,
  ChartBreakoutCircleIcon,
  ArrowMoveDownRightIcon,
} from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { maxLeverageFor } from "@/lib/markets";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { MarketSymbol } from "@/types";

/**
 * The market dock: a live readout of what the NEXT order will be.
 *
 * It used to be an add/reduce control that only existed while a position was
 * open. It is now always visible, because the numbers it shows — size,
 * leverage, trailing — apply to a flat account too; they are what the UP/DOWN
 * buttons will use. Tapping it opens the market settings sheet rather than
 * expanding in place, so the editing surface has room for sliders, the
 * available balance and the positions list.
 *
 * The values are READ-ONLY here and come from the same settings slice the
 * order path reads, so the dock cannot drift from what actually gets sent.
 *
 * SIZE IS THE ONLY EDITABLE ONE now, so it is the only one shown. Leverage and
 * trailing are fixed (market cap and 0.1%), and a readout you cannot act on is
 * just noise on a dock this small — their rows are kept below behind a `false`
 * guard, matching the disabled sections in MarketSettingsSheet, so the 3-row
 * layout can come back with the controls.
 */

// Drag band insets (px from top / bottom of the viewport). The dock is docked to
// the vertical CENTER and can be dragged up/down within a band that clears the
// market selector (top) and the trade controls / "View positions" section
// (bottom) on the mobile layout. Purely vertical — it never leaves the left edge.
const TOP_INSET = 96; // clears the market header + a little gap
const BOTTOM_INSET = 190; // clears the trade controls / positions section

interface Props {
  symbol: MarketSymbol;
  /** Open the market settings sheet. */
  onOpen: () => void;
}

export function PositionDock({ symbol, onOpen }: Props) {
  const settings = useAppSelector((s) => s.settings);

  // Resolved the same way the order path resolves it: an unset market uses its
  // own cap, so the dock shows the leverage the next order will actually use.
  const lev =
    settings.leverageByMarket[symbol] ?? maxLeverageFor(symbol);
  const size = settings.defaultPositionSize;
  const trailPct = settings.defaultTrailPct * 100;

  // One-time "peek" nudge so the tab is noticed, then it rests flush.
  const [peeked, setPeeked] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setPeeked(true), 1400);
    return () => clearTimeout(id);
  }, []);

  // Vertical drag. `y` is an offset from the centered rest position.
  // Constraints are computed from the viewport so the dock stays in the allowed
  // band: below the market selector, above the trade controls / positions.
  const y = useMotionValue(0);
  const [constraints, setConstraints] = useState({ top: 0, bottom: 0 });
  useEffect(() => {
    const recompute = () => {
      const h = window.innerHeight;
      const center = h / 2;
      // Up: from center to TOP_INSET. Down: from center to (h - BOTTOM_INSET).
      const up = -(center - TOP_INSET);
      const down = h - BOTTOM_INSET - center;
      setConstraints({ top: Math.min(0, up), bottom: Math.max(0, down) });
      // Re-clamp current position if the viewport shrank past it.
      const cur = y.get();
      if (cur < up) y.set(up);
      else if (cur > down) y.set(down);
    };
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, [y]);

  // Distinguish a tap (open) from a drag (reposition) so dragging the dock
  // doesn't also open the sheet. Set on drag start, checked on click.
  const dragged = useRef(false);

  const activate = () => {
    // A click synthesized right after a drag is ignored (onDragEnd clears the
    // flag shortly after), so dragging never also opens the sheet.
    if (dragged.current) return;
    playSound("tap");
    haptic("tap");
    onOpen();
  };

  return (
    <motion.div
      className="pointer-events-auto absolute left-0 top-1/2 z-30 -translate-y-1/2 touch-none"
      style={{ y }}
      drag="y"
      dragConstraints={constraints}
      dragElastic={0.06}
      dragMomentum={false}
      onDragStart={() => {
        dragged.current = true;
        haptic("tap");
      }}
      onDragEnd={() => {
        // Clear the drag flag after the click that follows dragEnd would fire,
        // so a genuine tap right after still opens the sheet.
        setTimeout(() => {
          dragged.current = false;
        }, 50);
      }}
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: peeked ? 0 : 4 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <button
        type="button"
        onClick={activate}
        aria-label={`${symbol} order settings`}
        // 2 columns (icon, value) × 1 row (size).
        className="glass-inset grid grid-cols-[auto_auto] items-center gap-x-2 gap-y-1.5 rounded-r-2xl py-2.5 pl-2 pr-3 shadow-lg transition-transform active:scale-95"
      >
        <Cell
          icon={Coins01Icon}
          // Up to 4 decimals: the minimum is a 4-decimal number on the
          // high-leverage markets ($1.2625 on BTC), and rounding the display to
          // cents would show a size that is not the one being sent.
          value={`$${size.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          })}`}
          label="Size"
        />
        {/* Leverage + trailing rows — disabled alongside their controls in
            MarketSettingsSheet. See the note at the top of this file. */}
        {false && (
          <>
            <Cell
              icon={ChartBreakoutCircleIcon}
              value={`${lev.toFixed(2)}×`}
              label="Leverage"
            />
            <Cell
              icon={ArrowMoveDownRightIcon}
              value={`${trailPct.toFixed(2)}%`}
              label="Trailing"
            />
          </>
        )}
      </button>
    </motion.div>
  );
}

/** One row of the dock: its icon, then its value. Two grid cells, not a flex box,
 *  so every value column lines up regardless of icon width. */
function Cell({
  icon,
  value,
  label,
}: {
  icon: typeof Coins01Icon;
  value: string;
  label: string;
}) {
  return (
    <>
      <span
        className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.07] text-text-muted"
        aria-hidden
      >
        <HugeiconsIcon icon={icon} size={13} />
      </span>
      <span className="tabular text-left text-[11px] font-semibold leading-none text-text">
        <span className="sr-only">{label}: </span>
        {value}
      </span>
    </>
  );
}
