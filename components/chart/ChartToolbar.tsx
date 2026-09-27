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
    haptic("tap");
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
    haptic("tap");
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
        onClick={() => setOpen((o) => !o)}
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
            initial={{ opacity: 0, y: 6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="glass absolute bottom-full left-0 z-40 mb-2 grid origin-bottom-left grid-cols-5 gap-1 rounded-2xl p-1.5 shadow-lg"
          >
            {CANDLE_INTERVALS.map((iv) => {
              const active = iv === interval && !onLine;
              return (
                <button
                  key={iv}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => pickInterval(iv)}
                  className={`tabular h-8 min-w-[2.75rem] rounded-xl px-2 text-xs font-semibold transition-colors ${
                    active
                      ? "bg-up-soft text-up"
                      : "text-white/70 hover:bg-white/5 active:bg-white/10"
                  }`}
                >
                  {iv}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
