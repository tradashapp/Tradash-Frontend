"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ChartFrame } from "@/lib/chart/engine";
import type { Callout, CalloutTone } from "@/lib/momentum";
import { onReaction } from "@/lib/reactions";

export interface ReactionLayerHandle {
  /** Feed the chart's per-frame state so callouts ride the line's tip. */
  track: (frame: ChartFrame) => void;
}

interface Bubble extends Callout {
  id: number;
}

interface Flash {
  id: number;
  favorable: boolean;
  mega: boolean;
}

const MAX_BUBBLES = 2;
const LIFETIME_MS: Record<CalloutTone, number> = {
  good: 1500,
  bad: 1500,
  great: 1800,
  epic: 2200,
  warn: 2600,
};

// Flat colours, no glows — the pop-in motion is what sells the moment. Only
// the top tier is a step larger.
const TONE_CLASS: Record<CalloutTone, string> = {
  good: "text-up text-sm",
  great: "text-up text-sm",
  epic: "text-[#FFD84D] text-[15px]",
  bad: "text-down text-sm",
  warn: "text-amber-300 text-sm",
};

// Emoji callouts that pop from the head of the price line ("🎯 Perfect"), and
// an edge glow when the market surges. Listens on lib/reactions; positioned
// imperatively from the chart's frame callback so following the line costs a
// style write per frame, never a React render.
export const ReactionLayer = forwardRef<ReactionLayerHandle>(function ReactionLayer(
  _props,
  ref
) {
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const nextId = useRef(0);
  const reduceMotion = useReducedMotion();

  useImperativeHandle(ref, () => ({
    track(frame) {
      const el = anchorRef.current;
      if (!el || !(frame.headX > 0)) return;
      el.style.transform = `translate3d(${frame.headX}px, ${frame.headY}px, 0)`;
      el.style.opacity = "1";
    },
  }));

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
    };
    const off = onReaction((r) => {
      const id = ++nextId.current;
      if (r.kind === "callout") {
        setBubbles((cur) => [...cur, { ...r.callout, id }].slice(-MAX_BUBBLES));
        later(
          () => setBubbles((cur) => cur.filter((b) => b.id !== id)),
          LIFETIME_MS[r.callout.tone]
        );
      } else {
        setFlash({ id, favorable: r.favorable, mega: r.mega });
        later(() => setFlash((f) => (f?.id === id ? null : f)), 900);
      }
    });
    return () => {
      off();
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-live="polite">
      <AnimatePresence>
        {flash && (
          <motion.div
            key={flash.id}
            className="absolute inset-0"
            style={{
              boxShadow: `inset 0 0 ${flash.mega ? 70 : 50}px ${
                flash.favorable ? "rgba(114,233,18,0.16)" : "rgba(230,67,45,0.13)"
              }`,
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0.6, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9, times: [0, 0.15, 0.5, 1] }}
          />
        )}
      </AnimatePresence>

      {/* The anchor sits ON the line's tip; bubbles stack up and to the left
          of it, so they never cover the price pill on the right. Hidden until
          the first frame reports where the tip is. */}
      <div
        ref={anchorRef}
        className="absolute left-0 top-0 opacity-0"
        style={{ willChange: "transform" }}
      >
        <div className="absolute bottom-5 right-3 flex flex-col items-end gap-1.5">
          <AnimatePresence initial={false}>
            {bubbles.map((b) => (
              <motion.div
                key={b.id}
                layout={!reduceMotion}
                initial={
                  reduceMotion
                    ? { opacity: 0 }
                    : { opacity: 0, scale: 0.4, y: 14, rotate: b.tone === "epic" ? -8 : 0 }
                }
                animate={{ opacity: 1, scale: 1, y: 0, rotate: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -18, scale: 0.9 }}
                transition={
                  reduceMotion
                    ? { duration: 0.15 }
                    : { type: "spring", stiffness: 520, damping: b.tone === "epic" ? 14 : 22 }
                }
                // No backing pill: bare text over the chart. The faint dark shadow is
                // only there to keep it legible where it crosses the line.
                className={`flex items-center gap-1 whitespace-nowrap font-bold italic tracking-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] ${TONE_CLASS[b.tone]}`}
              >
                <span className="not-italic">{b.emoji}</span>
                {b.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
});
