"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import {
  ChartEngine,
  type ChartFrame,
  type PositionOverlay,
} from "@/lib/chart/engine";
import { useLivePrice } from "@/hooks/useLivePrice";
import { useSplashDone } from "@/hooks/useSplashDone";
import type { MarketSymbol } from "@/types";

interface Props {
  symbol: MarketSymbol;
  /** Active position overlay (entry/liq lines + PnL fill), or null while flat. */
  position?: PositionOverlay | null;
  /** Called each animation frame with the latest chart state (for the dot grid). */
  onFrame?: (f: ChartFrame) => void;
  className?: string;
  /**
   * Drive the chart from an external price source instead of the oracle. Used
   * by the landing-page mockup, which runs a simulated feed. When set, the
   * oracle subscription is skipped entirely.
   */
  externalPrice?: number;
  /**
   * Start the render loop without waiting for the boot splash. The landing page
   * never mounts the splash, so its chart would otherwise stay frozen.
   */
  ignoreSplash?: boolean;
}

// Wraps the custom ChartEngine in a React component. The engine owns the rAF
// loop; React only manages its lifecycle and feeds it oracle ticks.
function CanvasChartImpl({
  symbol,
  position = null,
  onFrame,
  className,
  externalPrice,
  ignoreSplash = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  // The splash covers the whole viewport while it's up, so any frame we draw
  // before it lifts is painted for nobody — but still costs a full 600-point
  // bezier trace + blurred stroke every 16ms, competing with Privy/Redux boot
  // and the splash's own animations for the main thread. That contention is
  // what made the chart stutter for the first seconds after a reload.
  const splashReady = useSplashDone();
  const splashDone = ignoreSplash || splashReady;

  // Create the engine once the canvas mounts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new ChartEngine(canvas, {
      onFrame: (f) => onFrameRef.current?.(f),
    });
    engineRef.current = engine;

    // Keep the canvas correctly sized from the start; only the rAF loop waits.
    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  // Run the loop only while the chart is actually visible.
  useEffect(() => {
    if (!splashDone) return;
    const engine = engineRef.current;
    if (!engine) return;
    // Re-measure first: the canvas may have been laid out while hidden.
    engine.resize();
    engine.start();
    return () => engine.stop();
  }, [splashDone]);

  // On market switch, clear the window so the new feed starts fresh.
  useEffect(() => {
    engineRef.current?.reset();
  }, [symbol]);

  // Push the active position overlay into the engine.
  useEffect(() => {
    engineRef.current?.setPosition(position);
  }, [position]);

  // Feed oracle ticks straight into the engine's interpolator. When an external
  // price is supplied the subscription is inert (`external` symbol has no feed),
  // and the effect below pushes the caller's prices instead.
  const external = externalPrice != null;
  const handleTick = useCallback(
    (price: number) => {
      if (external) return;
      engineRef.current?.setPrice(price);
    },
    [external]
  );
  useLivePrice(external ? null : symbol, handleTick);

  useEffect(() => {
    if (externalPrice == null) return;
    engineRef.current?.setPrice(externalPrice);
  }, [externalPrice]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

// The heavy work (the canvas rAF loop) never re-runs on re-render — it's driven
// imperatively. Re-rendering only re-runs the cheap setPosition effect, so we
// compare every position field EXACTLY (including PnL, which the mark-line pill
// shows live) and just ignore onFrame identity to avoid churn from the parent.
function samePosition(
  a: PositionOverlay | null | undefined,
  b: PositionOverlay | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.entryPrice === b.entryPrice &&
    a.liquidationPrice === b.liquidationPrice &&
    a.trailStopPrice === b.trailStopPrice &&
    a.pnl === b.pnl
  );
}

export const CanvasChart = memo(CanvasChartImpl, (a, b) => {
  return (
    a.symbol === b.symbol &&
    a.className === b.className &&
    a.externalPrice === b.externalPrice &&
    a.ignoreSplash === b.ignoreSplash &&
    samePosition(a.position, b.position)
  );
});
