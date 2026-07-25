"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { ChartFrame } from "@/lib/chart/engine";

export interface DotGridHandle {
  react: (frame: ChartFrame) => void;
}

const SPACING = 34; // px between dots
const DOT_RADIUS = 1.1;

// A canvas dot grid that drifts vertically as the price moves, giving the chart
// a sense of parallax depth. Driven imperatively from the chart's per-frame
// callback so it never triggers React re-renders.
export const DotGrid = forwardRef<DotGridHandle, { className?: string }>(
  function DotGrid({ className }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const offset = useRef(0); // accumulated vertical drift
    const targetOffset = useRef(0);
    const raf = useRef(0);
    const size = useRef({ w: 0, h: 0, dpr: 1 });

    useImperativeHandle(ref, () => ({
      react(frame: ChartFrame) {
        // Price rising → grid drifts down slightly (and vice versa). Scaled and
        // clamped so it stays subtle even in volatile bursts.
        const shift = Math.max(-6, Math.min(6, frame.velocity * 0.4));
        targetOffset.current += shift;
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        size.current = { w: rect.width, h: rect.height, dpr };
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);

      const draw = () => {
        // Ease drift toward its target and wrap within one grid cell.
        offset.current += (targetOffset.current - offset.current) * 0.06;
        const { w, h } = size.current;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#1a1d26";

        const oy = ((offset.current % SPACING) + SPACING) % SPACING;
        for (let x = 0; x <= w + SPACING; x += SPACING) {
          for (let y = -SPACING; y <= h + SPACING; y += SPACING) {
            ctx.beginPath();
            ctx.arc(x, y + oy, DOT_RADIUS, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        raf.current = requestAnimationFrame(draw);
      };
      raf.current = requestAnimationFrame(draw);

      return () => {
        ro.disconnect();
        cancelAnimationFrame(raf.current);
      };
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className={className}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    );
  }
);
