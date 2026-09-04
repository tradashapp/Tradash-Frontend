"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatUsd } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import {
  PNL_RANGES,
  usePnlSeries,
  type PnlPoint,
  type PnlRange,
} from "@/hooks/usePnlSeries";

// Expandable P&L chart under the balance card. Green when the window is up,
// red when it's down — the whole chart (line, fill, dot, figures) recolours
// together, so the direction reads before any number does.

const UP = "#72E912";
const DOWN = "#E6432D";

// Viewbox units. The path is drawn in this space and scaled by the SVG, so the
// component stays resolution-independent without measuring the DOM.
const W = 320;
const H = 96;
const PAD_Y = 10; // headroom so the stroke and dot never clip at the edges

/**
 * Project the series into viewbox coordinates.
 *
 * X is spread over TIME, not sample index: trades are clustered (several in a
 * busy minute, then hours of nothing), so index-spacing would draw a flat line
 * through quiet stretches and compress a burst into a cliff. Y is inverted
 * (SVG grows downward) and always includes zero, so the baseline is meaningful.
 */
function project(points: PnlPoint[]): {
  coords: { x: number; y: number }[];
  zeroY: number;
} {
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = t1 - t0;
  // Every point sharing a timestamp (a burst of closes in the same millisecond,
  // or a single point) collapses the time axis. Fall back to even index
  // spacing so the curve still spans the width instead of stacking on x=0.
  const degenerate = span <= 0;
  const lastIndex = Math.max(points.length - 1, 1);

  const values = points.map((p) => p.v);
  let lo = Math.min(...values, 0);
  let hi = Math.max(...values, 0);
  // A perfectly flat series (all zeros) would divide by zero — give it room so
  // the line lands mid-height instead of collapsing onto an edge.
  if (hi - lo < 1e-9) {
    hi += 1;
    lo -= 1;
  }
  const range = hi - lo;
  const toY = (v: number) =>
    H - PAD_Y - ((v - lo) / range) * (H - PAD_Y * 2);

  return {
    coords: points.map((p, i) => ({
      x: degenerate ? (i / lastIndex) * W : ((p.t - t0) / span) * W,
      y: toY(p.v),
    })),
    zeroY: toY(0),
  };
}

/**
 * Smooth the polyline into a path with Catmull-Rom-style control points.
 *
 * A raw polyline of trade-to-trade jumps looks like a sawtooth; easing the
 * corners reads as an equity curve without misrepresenting any point, since
 * every original coordinate is still on the path.
 */
function toPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M${coords[0].x} ${coords[0].y}`;
  let d = `M${coords[0].x} ${coords[0].y}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i === 0 ? 0 : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    // Tension 1/6 keeps the curve tight to the data — a looser value overshoots
    // on sharp P&L jumps and would draw profit that never existed.
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function PnlChart({
  open,
  floatingPnl,
  currentBalance,
}: {
  open: boolean;
  /** Live unrealized P&L — drives the tip in real time. */
  floatingPnl: number;
  currentBalance: number | null;
}) {
  const [range, setRange] = useState<PnlRange>("24h");
  const series = usePnlSeries(range, floatingPnl, currentBalance);
  const up = series.net >= 0;
  const color = up ? UP : DOWN;

  const { path, area, tip, zeroY } = useMemo(() => {
    const { coords, zeroY } = project(series.points);
    const path = toPath(coords);
    const last = coords[coords.length - 1];
    return {
      path,
      // Close the shape down to the baseline for the gradient fill.
      area: path ? `${path} L${last.x} ${H} L${coords[0].x} ${H} Z` : "",
      tip: last,
      zeroY,
    };
  }, [series.points]);

  // The gradient id must be unique per direction, or a cached green gradient
  // would keep filling a chart that has since turned red.
  const gradId = `pnlFill-${up ? "up" : "down"}`;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="pnl-chart"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="pt-3">
            {/* Window total, restated because the pills change what "P&L" means
                here — the row above always shows TODAY, this shows the window. */}
            <div className="mb-1 flex items-baseline justify-between">
              <span
                className={`tabular text-lg font-semibold ${up ? "text-up" : "text-down"}`}
              >
                {up ? "+" : "−"}
                {formatUsd(Math.abs(series.net))}
              </span>
              {series.pct != null && (
                <span
                  className={`tabular text-xs font-medium ${up ? "text-up" : "text-down"}`}
                >
                  {up ? "+" : "−"}
                  {Math.abs(series.pct).toFixed(2)}%
                </span>
              )}
            </div>

            <div className="relative">
              <svg
                viewBox={`0 0 ${W} ${H}`}
                width="100%"
                height={H}
                preserveAspectRatio="none"
                fill="none"
                role="img"
                aria-label={`Profit and loss over ${range}`}
                className="overflow-visible"
              >
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.28" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Break-even baseline — without it a chart that's entirely
                    below zero still looks like a rising line. */}
                <line
                  x1={0}
                  y1={zeroY}
                  x2={W}
                  y2={zeroY}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                  vectorEffect="non-scaling-stroke"
                />

                {/* Re-keyed on the range so switching windows redraws rather
                    than morphing between two unrelated shapes. */}
                <motion.path
                  key={`area-${range}-${up}`}
                  d={area}
                  fill={`url(#${gradId})`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.25 }}
                />
                <motion.path
                  key={`line-${range}-${up}`}
                  d={path}
                  stroke={color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                />
              </svg>

              {/* Live tip. Positioned in PERCENT over the svg rather than drawn
                  inside it: preserveAspectRatio="none" stretches the viewbox
                  horizontally, which would squash a circle into an ellipse. */}
              <motion.div
                className="pointer-events-none absolute"
                style={{
                  left: `${(tip.x / W) * 100}%`,
                  top: `${(tip.y / H) * 100}%`,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.3 }}
              >
                <span className="relative -ml-[5px] -mt-[5px] block h-2.5 w-2.5">
                  {/* Expanding halo — the "still ticking" signal. */}
                  <motion.span
                    className="absolute inset-0 rounded-full"
                    style={{ backgroundColor: color }}
                    animate={{ scale: [1, 2.6], opacity: [0.5, 0] }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      ease: "easeOut",
                    }}
                  />
                  <span
                    className="absolute inset-0 rounded-full ring-2 ring-bg-elevated"
                    style={{ backgroundColor: color }}
                  />
                </span>
              </motion.div>
            </div>

            {/* Range pills. */}
            <div className="mt-3 flex items-center gap-1.5">
              {PNL_RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    haptic("tap");
                    setRange(r.id);
                  }}
                  aria-pressed={range === r.id}
                  className={`flex-1 rounded-lg py-1.5 text-[11px] font-semibold transition-colors ${
                    range === r.id
                      ? "bg-white/[0.14] text-text"
                      : "text-text-muted hover:bg-white/[0.06]"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {series.tradeCount === 0 && (
              <p className="mt-2 text-center text-[11px] text-text-muted">
                No closed trades in this window
                {floatingPnl !== 0 ? " — showing open positions only" : ""}.
              </p>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
