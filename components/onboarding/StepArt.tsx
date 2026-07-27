"use client";

import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  ArrowMoveUpRightIcon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";

// Small, on-brand illustrations for each tutorial step — built in-app (no
// external assets) with the same look as the real UI, lightly animated.

const FRAME =
  "glass relative flex h-44 w-full max-w-xs items-center justify-center overflow-hidden rounded-3xl";

export function StepArt({
  art,
}: {
  art: "chart" | "updown" | "pnl" | "trail" | "close";
}) {
  switch (art) {
    case "chart":
      return (
        <div className={FRAME}>
          <DotGridBg />
          <MiniChart />
        </div>
      );
    case "updown":
      return (
        <div className={FRAME}>
          <DotGridBg />
          <div className="relative z-10 grid w-full grid-cols-2 gap-3 px-5">
            <motion.div
              animate={{ scale: [1, 0.94, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, repeatDelay: 0.4 }}
              className="flex items-center justify-center gap-1 rounded-2xl bg-up-soft py-4 font-semibold text-up"
            >
              <HugeiconsIcon icon={ArrowUp01Icon} size={18} /> UP
            </motion.div>
            <div className="flex items-center justify-center gap-1 rounded-2xl bg-down-soft py-4 font-semibold text-down">
              <HugeiconsIcon icon={ArrowDown01Icon} size={18} /> DOWN
            </div>
          </div>
        </div>
      );
    case "pnl":
      return (
        <div className={FRAME}>
          <DotGridBg />
          <MiniChart withPnl />
        </div>
      );
    case "trail":
      return (
        <div className={FRAME}>
          <DotGridBg />
          <MiniChart withTrail />
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-up px-3 py-1.5 text-xs font-bold text-black">
            <HugeiconsIcon icon={ArrowMoveUpRightIcon} size={14} /> Trailing
          </div>
        </div>
      );
    case "close":
      return (
        <div className={FRAME}>
          <DotGridBg />
          <MiniChart withPnl />
          <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-white/15 px-4 py-1.5 text-xs font-bold text-text">
            <HugeiconsIcon icon={Cancel01Icon} size={14} /> Close
          </div>
        </div>
      );
  }
}

function DotGridBg() {
  return (
    <div
      className="absolute inset-0 opacity-40"
      style={{
        backgroundImage: "radial-gradient(#1a1d26 1px, transparent 1px)",
        backgroundSize: "16px 16px",
      }}
    />
  );
}

// A small animated line that sweeps in, echoing the real chart.
function MiniChart({
  withPnl,
  withTrail,
}: {
  withPnl?: boolean;
  withTrail?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 260 120"
      className="relative z-10 h-full w-full px-6"
      preserveAspectRatio="none"
    >
      {withTrail && (
        <line
          x1="0"
          y1="52"
          x2="260"
          y2="52"
          stroke="#72E912"
          strokeWidth="1.5"
          strokeDasharray="6 4"
          opacity="0.7"
        />
      )}
      <motion.path
        d="M0,90 C40,86 55,60 90,64 C125,68 140,40 175,44 C210,48 230,30 260,34"
        fill="none"
        stroke="#72E912"
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: "easeInOut" }}
        style={{ filter: "drop-shadow(0 0 6px rgba(114,233,18,0.5))" }}
      />
      {withPnl && (
        <g>
          <rect x="196" y="20" width="60" height="26" rx="6" fill="#72E912" />
          <text
            x="226"
            y="37"
            textAnchor="middle"
            fontSize="12"
            fontWeight="700"
            fill="#08090c"
            fontFamily="ui-monospace, monospace"
          >
            +$42
          </text>
        </g>
      )}
    </svg>
  );
}
