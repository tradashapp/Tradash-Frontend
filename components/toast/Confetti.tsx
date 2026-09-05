"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Confetti burst for profitable closes. Canvas, not DOM nodes: a burst is ~70
// pieces animating every frame, and that many motion.divs would thrash layout
// on exactly the frame the toast is springing in.
//
// The piece count and lifetime are deliberately small. This fires on a real
// money event, so it should read as a flourish that punctuates the toast and
// gets out of the way — not a celebration that outlives the thing it celebrates.

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  w: number;
  h: number;
  color: string;
  /** Per-piece drag so the spread thins out instead of moving as one sheet. */
  drag: number;
}

// Brand green (#72E912) plus warm gold and a near-white sparkle. Tinted around
// the "up" hue rather than rainbow, so the burst reads as *this* app's profit
// colour and never competes with the red loss state.
const COLORS = ["#72E912", "#A6F55C", "#4FC300", "#F5D90A", "#FFFFFF"];

const GRAVITY = 0.14;
const LIFETIME_MS = 1100;

export function Confetti({ trigger }: { trigger: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [reduced, setReduced] = useState(false);

  // Respect the OS "reduce motion" setting: people who set it get the toast
  // and the sound, just not the particles.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const dpr = useMemo(
    () => (typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2)),
    []
  );

  useEffect(() => {
    // trigger === 0 is the initial mount: nothing has been won yet.
    if (!trigger || reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Two vents near the toast's lower corners, angled up and outward — the
    // shape a physical popper makes. A single centre burst reads as a "pop-up"
    // notification effect; two vents frame the message instead of covering it.
    const pieces: Piece[] = [];
    const vents = [
      { x: rect.width * 0.18, dir: 1 },
      { x: rect.width * 0.82, dir: -1 },
    ];

    for (const vent of vents) {
      for (let i = 0; i < 34; i++) {
        // Cone: mostly upward, fanned toward the middle of the toast.
        const spread = (Math.random() - 0.5) * 0.9;
        const angle = -Math.PI / 2 + spread + vent.dir * 0.42;
        const speed = 3.6 + Math.random() * 3.4;
        pieces.push({
          x: vent.x,
          y: rect.height * 0.86,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 0.34,
          w: 4 + Math.random() * 4,
          h: 6 + Math.random() * 6,
          color: COLORS[(Math.random() * COLORS.length) | 0],
          drag: 0.982 + Math.random() * 0.012,
        });
      }
    }

    const start = performance.now();

    const frame = (now: number) => {
      const elapsed = now - start;
      const t = elapsed / LIFETIME_MS;
      if (t >= 1) {
        ctx.clearRect(0, 0, rect.width, rect.height);
        rafRef.current = null;
        return;
      }

      ctx.clearRect(0, 0, rect.width, rect.height);
      // Hold full opacity through the first half, then fade — pieces vanish
      // together as the toast settles rather than lingering as stragglers.
      const alpha = t < 0.5 ? 1 : 1 - (t - 0.5) / 0.5;

      for (const p of pieces) {
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + GRAVITY;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vrot;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        // Flip the height by a cosine of the spin to fake a foil rectangle
        // tumbling in 3D — cheaper than real perspective, reads the same.
        const squash = Math.abs(Math.cos(p.rot));
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, Math.max(1, p.h * squash));
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      ctx.clearRect(0, 0, rect.width, rect.height);
    };
  }, [trigger, reduced, dpr]);

  if (reduced) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      // Overflows the toast so pieces can fly past its edges, and sits behind
      // the content so text stays readable through the burst.
      className="pointer-events-none absolute -inset-x-16 -inset-y-12 -z-10 h-[calc(100%+6rem)] w-[calc(100%+8rem)]"
    />
  );
}
