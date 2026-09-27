"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ChartCandlestickIcon,
  ChartLineData01Icon,
} from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { CANDLE_INTERVALS, type CandleInterval } from "@/lib/bulk/candles";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";

interface Props {
  className?: string;
}

// Chart controls at the chart's bottom-left: the candle interval ("1m") and the
// chart-type toggle (candles ⇄ the live tick line). Both are persisted settings,
// so the choice survives reloads and market switches.
//
// The interval only applies to candles. On the line it stays visible but dimmed
// — the line is a live ~10s tick view, not an interval — and picking one
// switches to candles at that interval.

// The menu groups intervals by unit, one row each, so the cells get real room.
const INTERVAL_GROUPS: { label: string; items: CandleInterval[] }[] = [
  { label: "Minutes", items: CANDLE_INTERVALS.filter((iv) => iv.endsWith("m")) },
  { label: "Hours & days", items: CANDLE_INTERVALS.filter((iv) => !iv.endsWith("m")) },
];

/** Every control here gives the same tap feedback as the rest of the app. */
function feedback() {
  playSound("tap");
  haptic("tap");
}

export function ChartToolbar({ className }: Props) {
  const dispatch = useAppDispatch();
  const view = useAppSelector((s) => s.settings.chartView);
  const interval = useAppSelector((s) => s.settings.chartInterval);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Dismiss the interval menu on an outside tap or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pickInterval = (next: CandleInterval) => {
    feedback();
    setOpen(false);
    dispatch(
      updateSettings({
        chartInterval: next,
        chartView: "candles",
        chartViewTouched: true,
      })
    );
  };

  const toggleView = () => {
    feedback();
    setOpen(false);
    dispatch(
      updateSettings({
        chartView: view === "candles" ? "line" : "candles",
        chartViewTouched: true,
      })
    );
  };

  const onLine = view === "line";

  return (
    <div ref={rootRef} className={`relative flex items-center gap-2 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => {
          feedback();
          setOpen((o) => !o);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Candle interval: ${interval}`}
        className={`glass-inset tabular flex h-9 items-center gap-1 rounded-full px-3 text-xs font-semibold backdrop-blur-sm transition-[opacity,transform] duration-150 active:scale-95 ${
          onLine ? "text-white/45" : "text-white/90"
        }`}
      >
        {interval}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <button
        type="button"
        onClick={toggleView}
        aria-label={onLine ? "Switch to candles" : "Switch to line chart"}
        className="glass-inset flex h-9 w-9 items-center justify-center rounded-full text-white/90 backdrop-blur-sm transition-transform duration-150 active:scale-95"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={view}
            initial={{ opacity: 0, rotate: -30, scale: 0.8 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 30, scale: 0.8 }}
            transition={{ duration: 0.14 }}
            className="flex"
          >
            <HugeiconsIcon
              icon={onLine ? ChartLineData01Icon : ChartCandlestickIcon}
              size={18}
            />
          </motion.span>
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Candle interval"
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="glass absolute bottom-full left-0 z-40 mb-3 w-[17.5rem] origin-bottom-left rounded-2xl p-3 shadow-2xl"
          >
            {INTERVAL_GROUPS.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? "mt-3" : ""}>
                <p className="mb-2 px-0.5 text-[10px] font-medium uppercase tracking-wide text-text-muted">
                  {group.label}
                </p>
                <div className="grid grid-cols-5 gap-2">
                  {group.items.map((iv) => {
                    const active = iv === interval && !onLine;
                    return (
                      <button
                        key={iv}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => pickInterval(iv)}
                        className={`tabular h-10 rounded-xl text-[13px] font-semibold transition-colors active:scale-95 ${
                          active
                            ? "bg-up text-black"
                            : "bg-white/[0.05] text-white/75 hover:bg-white/10"
                        }`}
                      >
                        {iv}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
