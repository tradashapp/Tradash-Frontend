"use client";

import { useEffect, useRef } from "react";
import { ChartEngine, type ChartFrame, type PositionOverlay } from "@/lib/chart/engine";
import { indexAt, priceAtIndex, type ReplayTimeline } from "@/lib/replay/playback";

interface Props {
  timeline: ReplayTimeline;
  /** Playback progress, 0..1. Driven by the player's clock or the scrubber. */
  progress: number;
  /** Entry/liq overlay, with PnL recomputed for the replayed moment. */
  position: PositionOverlay;
  onFrame?: (f: ChartFrame) => void;
  className?: string;
}

/**
 * The trade-replay chart. Reuses the live ChartEngine in DRIVEN mode so the
 * replay is rendered by exactly the same code as the real screen — same line,
 * gradient band, entry/liq lines, price scale and glow — rather than a
 * look-alike that would drift out of sync with the real chart over time.
 *
 * The engine is fed a window of the recorded path ending at the current
 * playback position, so the line grows and scrolls the way it did live.
 */
export function ReplayChart({
  timeline,
  progress,
  position,
  onFrame,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<ChartEngine | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ChartEngine(canvas, {
      onFrame: (f) => onFrameRef.current?.(f),
    });
    engine.setDriven(true);
    engineRef.current = engine;

    const ro = new ResizeObserver(() => engine.resize());
    ro.observe(canvas);
    // The replay sheet mounts above the splash gate, so start immediately.
    engine.resize();
    engine.start();

    return () => {
      ro.disconnect();
      engine.stop();
      engineRef.current = null;
    };
  }, []);

  // Push the overlay (its PnL changes every frame, which recolors the line).
  useEffect(() => {
    engineRef.current?.setPosition(position);
  }, [position]);

  // Re-seed the window for the current progress. Seeding (rather than pushing
  // one sample per frame) is what makes scrubbing work: dragging backwards
  // simply rebuilds a shorter window, with no history to unwind.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const index = indexAt(timeline, progress);
    const upto = Math.floor(index);
    const window = timeline.samples.slice(0, upto + 1);
    if (window.length === 0) return;
    // Replace the final sample with the interpolated price so the leading point
    // glides between recorded samples instead of stepping.
    const head = window.slice(0, -1);
    head.push({
      t: window[window.length - 1]!.t,
      p: priceAtIndex(timeline, index),
    });
    engine.seed(head);
  }, [timeline, progress]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}
