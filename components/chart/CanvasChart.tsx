"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  ChartEngine,
  type ChartFrame,
  type PositionOverlay,
} from "@/lib/chart/engine";
import { useLivePrice } from "@/hooks/useLivePrice";
import type { MarketSymbol } from "@/types";

interface Props {
  symbol: MarketSymbol;
  /** Active position overlay (entry/liq lines + PnL fill), or null while flat. */
  position?: PositionOverlay | null;
  /** Called each animation frame with the latest chart state (for the dot grid). */
  onFrame?: (f: ChartFrame) => void;
  className?: string;
}

// Wraps the custom ChartEngine in a React component. The engine owns the rAF
// loop; React only manages its lifecycle and feeds it oracle ticks.
export function CanvasChart({ symbol, position = null, onFrame, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Create the engine once the canvas mounts.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new ChartEngine(canvas, {
      onFrame: (f) => onFrameRef.current?.(f),
    });
    engineRef.current = engine;
    engine.start();

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);

    return () => {
      ro.disconnect();
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  // On market switch, clear the window so the new feed starts fresh.
  useEffect(() => {
    engineRef.current?.reset();
  }, [symbol]);

  // Push the active position overlay into the engine.
  useEffect(() => {
    engineRef.current?.setPosition(position);
  }, [position]);

  // Feed oracle ticks straight into the engine's interpolator.
  const handleTick = useCallback((price: number) => {
    engineRef.current?.setPrice(price);
  }, []);
  useLivePrice(symbol, handleTick);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
