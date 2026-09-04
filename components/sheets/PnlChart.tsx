"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
//
// The window's own figures are NOT restated here: the range pills re-label the
// balance row above ("Today's P&L" → "7D P&L"), so a second copy of the same
// number inside the chart would be redundant and contradictory-looking.

const UP = "#72E912";
const DOWN = "#E6432D";

// Viewbox units. The path is drawn in this space and scaled by the SVG, so the
// component stays resolution-independent without measuring the DOM.
const W = 320;
const H = 96;
const PAD_Y = 12; // headroom so the stroke and dot never clip at the edges

/**
 * Project the series into viewbox coordinates.
 *
 * X is spread over TIME, not sample index: the series is resampled onto an even
 * time grid upstream, but an "all" window with a single burst of trades can
 * still collapse, so the degenerate case falls back to index spacing. Y is
 * inverted (SVG grows downward) and always includes zero, so the baseline is
 * meaningful.
 */
function project(points: PnlPoint[]): {
  coords: { x: number; y: number }[];
  zeroY: number;
} {
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = t1 - t0;
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
  const toY = (v: number) => H - PAD_Y - ((v - lo) / range) * (H - PAD_Y * 2);

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
 * The upstream series is already resampled and averaged, so this only has to
 * round the joins between samples; the combination is what produces the
 * continuous wave rather than a sawtooth of trade-to-trade jumps.
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
    // and would draw profit that never existed.
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** "12 Mar, 14:05" — enough to place a point without wrapping the tooltip. */
function formatStamp(t: number): string {
  return new Date(t).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PnlChart({
  open,
  floatingPnl,
  currentBalance,
  range,
  onRangeChange,
}: {
  open: boolean;
  /** Live unrealized P&L — drives the tip in real time. */
  floatingPnl: number;
  currentBalance: number | null;
  /** Owned by the balance card, because the pills re-label its P&L row. */
  range: PnlRange;
  onRangeChange: (r: PnlRange) => void;
}) {
  const series = usePnlSeries(range, floatingPnl, currentBalance);
  const up = series.net >= 0;
  const color = up ? UP : DOWN;

  // Index of the sample under the cursor/finger, or null when not scrubbing.
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  // The last index we fired a haptic for, so crossing into a new node ticks
  // exactly once rather than on every pointer move within the same node.
  const lastHapticIndex = useRef<number | null>(null);
  // Touch scrubbing is press-AND-HOLD: a plain swipe over the chart has to stay
  // a scroll. The timer promotes a stationary touch into a scrub.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);

  const { path, area, coords, zeroY } = useMemo(() => {
    const { coords, zeroY } = project(series.points);
    const path = toPath(coords);
    const last = coords[coords.length - 1];
    return {
      path,
      // Close the shape down to the baseline for the gradient fill.
      area: path ? `${path} L${last.x} ${H} L${coords[0].x} ${H} Z` : "",
      coords,
      zeroY,
    };
  }, [series.points]);

  // Where the marker sits: the scrubbed sample while scrubbing, the live tip
  // otherwise. One value drives the dot, the dim mask and the tooltip so they
  // can never disagree about which point is active.
  const markerIndex = activeIndex ?? coords.length - 1;
  const marker = coords[markerIndex] ?? coords[coords.length - 1];
  const markerPoint = series.points[markerIndex] ?? series.points[series.points.length - 1];
  const scrubbing = activeIndex != null;

  /** Map a client X onto the nearest sample, ticking a haptic on each new node. */
  const scrubTo = useCallback(
    (clientX: number) => {
      const el = plotRef.current;
      if (!el || coords.length === 0) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      // Nearest by x in viewbox space, not by index — the samples are evenly
      // spaced in TIME, which is only evenly spaced in x for a healthy window.
      const target = ratio * W;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < coords.length; i++) {
        const d = Math.abs(coords[i].x - target);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      setActiveIndex(best);
      if (lastHapticIndex.current !== best) {
        lastHapticIndex.current = best;
        haptic("tap");
      }
    },
    [coords]
  );

  const endScrub = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
    setActiveIndex(null);
    lastHapticIndex.current = null;
  }, []);

  // Collapsing the chart mid-scrub would otherwise leave the dim mask stuck on.
  useEffect(() => {
    if (!open) endScrub();
  }, [open, endScrub]);

  // Pointer handlers. Mouse/pen scrub on hover; touch requires a hold, so the
  // page can still be scrolled by dragging across the chart.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      const { clientX } = e;
      holdTimer.current = setTimeout(() => {
        setHolding(true);
        // The hold itself gets a beat, so the user feels the mode change before
        // the per-node ticks start.
        haptic("open");
        scrubTo(clientX);
      }, 180);
      return;
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubTo(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") {
      if (!holding) {
        // Moved before the hold matured — it's a scroll, not a scrub.
        if (holdTimer.current) {
          clearTimeout(holdTimer.current);
          holdTimer.current = null;
        }
        return;
      }
      // Once holding, the gesture is ours: stop the page scrolling under it.
      e.preventDefault();
    } else if (e.buttons === 0 && activeIndex == null) {
      // Plain hover before any press — still scrub, that's the desktop affordance.
    }
    scrubTo(e.clientX);
  };

  // The gradient id must be unique per direction, or a cached green gradient
  // would keep filling a chart that has since turned red.
  const gradId = `pnlFill-${up ? "up" : "down"}`;
  const maskId = `pnlMask-${up ? "up" : "down"}`;
  // Everything right of the marker is masked back — the scrubbed portion reads
  // as "what had happened by then", the rest as the future you're ignoring.
  const dimFrom = scrubbing ? (marker.x / W) * 100 : 100;

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
            <div
              ref={plotRef}
              className="relative select-none"
              style={{ touchAction: holding ? "none" : "pan-y" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onPointerLeave={endScrub}
            >
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
                  {/* Luminance mask: white keeps the paint, grey fades it. The
                      hard stop at the marker is what makes the split read as a
                      position rather than a gradient. */}
                  <linearGradient id={maskId} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#fff" />
                    <stop offset={`${dimFrom}%`} stopColor="#fff" />
                    <stop offset={`${dimFrom}%`} stopColor="#4d4d4d" />
                    <stop offset="100%" stopColor="#4d4d4d" />
                  </linearGradient>
                  <mask id={`${maskId}-m`}>
                    <rect x="0" y="0" width={W} height={H} fill={`url(#${maskId})`} />
                  </mask>
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

                <g mask={`url(#${maskId}-m)`}>
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
                </g>

                {/* Scrub crosshair. */}
                {scrubbing && (
                  <line
                    x1={marker.x}
                    y1={0}
                    x2={marker.x}
                    y2={H}
                    stroke="rgba(255,255,255,0.28)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </svg>

              {/* Marker dot. Positioned in PERCENT over the svg rather than
                  drawn inside it: preserveAspectRatio="none" stretches the
                  viewbox horizontally, which would squash a circle into an
                  ellipse. It sits ABOVE the svg in z-order and carries a dark
                  ring, which is what makes it legible against the line — drawn
                  inside the masked group it was being dimmed away. */}
              <motion.div
                className="pointer-events-none absolute z-10"
                style={{
                  left: `${(marker.x / W) * 100}%`,
                  top: `${(marker.y / H) * 100}%`,
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7, duration: 0.3 }}
              >
                <span className="relative -ml-[4px] -mt-[4px] block h-2 w-2">
                  {/* Expanding halo — the "still ticking" signal. Suppressed
                      while scrubbing, where the dot marks a fixed past instant
                      and a pulse would imply it's live. */}
                  {!scrubbing && (
                    <motion.span
                      className="absolute inset-0 rounded-full"
                      style={{ backgroundColor: color }}
                      animate={{ scale: [1, 2.8], opacity: [0.55, 0] }}
                      transition={{
                        duration: 1.8,
                        repeat: Infinity,
                        ease: "easeOut",
                      }}
                    />
                  )}
                  <span
                    className="absolute inset-0 rounded-full ring-[3px] ring-black/70"
                    style={{
                      backgroundColor: color,
                      boxShadow: `0 0 8px ${color}`,
                    }}
                  />
                </span>
              </motion.div>

              {/* Tooltip: the moment, and what the account was worth at it. */}
              <AnimatePresence>
                {scrubbing && (
                  <motion.div
                    className="pointer-events-none absolute -top-1 z-20 -translate-y-full"
                    style={{
                      left: `${(marker.x / W) * 100}%`,
                      // Keep the box inside the plot at both ends instead of
                      // letting it hang off the edge of the card.
                      transform: "translate(-50%, -100%)",
                      marginLeft:
                        marker.x / W < 0.15
                          ? `${(0.15 - marker.x / W) * 100}%`
                          : marker.x / W > 0.85
                            ? `${(0.85 - marker.x / W) * 100}%`
                            : undefined,
                    }}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.12 }}
                  >
                    <div className="glass-inset whitespace-nowrap rounded-lg px-2 py-1.5 text-center">
                      <div className="text-[9px] leading-tight text-text-muted">
                        {formatStamp(markerPoint.t)}
                      </div>
                      <div className="tabular text-[11px] font-semibold leading-tight">
                        {markerPoint.balance != null
                          ? formatUsd(markerPoint.balance)
                          : "—"}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Range pills — these also re-label the P&L row above the chart. */}
            <div className="mt-3 flex items-center gap-1.5">
              {PNL_RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    haptic("tap");
                    onRangeChange(r.id);
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
              <p className="mt-2 text-center text-[10px] text-text-muted">
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
