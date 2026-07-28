"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";

// Full-screen splash / preloader shown on first load: brand logo centered, with
// an animated chart-line loader directly beneath it, over a dark background.
// Self-dismisses after a short beat (or once the window fires `load`), then
// fades out and never returns for the session.
export function SplashScreen() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    // Minimum on-screen time so it reads as an intentional splash, not a flash.
    const MIN_MS = 1400;
    const started = performance.now();

    let done = false;
    const dismiss = () => {
      if (done) return;
      done = true;
      const elapsed = performance.now() - started;
      const wait = Math.max(0, MIN_MS - elapsed);
      window.setTimeout(() => setShow(false), wait);
    };

    if (document.readyState === "complete") {
      dismiss();
    } else {
      window.addEventListener("load", dismiss, { once: true });
    }
    // Hard cap so a hung `load` never traps the user behind the splash.
    const cap = window.setTimeout(dismiss, 3500);

    return () => {
      window.removeEventListener("load", dismiss);
      window.clearTimeout(cap);
    };
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-bg"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5, ease: "easeInOut" }}
        >
          {/* Logo */}
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <Image
              src="/icon.svg"
              alt="Tradash"
              width={88}
              height={88}
              priority
              className="h-20 w-20 rounded-2xl"
            />
          </motion.div>

          {/* Chart-line loader, directly under the logo. */}
          <div className="mt-7">
            <ChartLoader />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// A small animated line chart: the path draws itself in, a soft gradient fills
// beneath it, and a dot rides the leading edge — a compact "market is loading"
// motif in the brand green.
function ChartLoader() {
  const W = 160;
  const H = 44;
  // A gentle upward-trending zigzag.
  const d = "M4 34 L28 24 L52 30 L76 14 L100 22 L124 8 L156 12";

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fill="none"
      className="overflow-visible"
      aria-label="Loading"
      role="img"
    >
      <defs>
        <linearGradient id="splashFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#72E912" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#72E912" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Gradient area under the line (fades in with the draw). */}
      <motion.path
        d={`${d} L156 ${H} L4 ${H} Z`}
        fill="url(#splashFill)"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 1, 1, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* The line, drawing itself repeatedly. */}
      <motion.path
        d={d}
        stroke="#72E912"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0, opacity: 0.4 }}
        animate={{ pathLength: [0, 1, 1], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />

      {/* Leading dot riding the end of the line. */}
      <motion.circle
        cx={156}
        cy={12}
        r={4}
        fill="#72E912"
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: [0, 0, 1, 1, 0], scale: [0.6, 0.6, 1, 1, 0.6] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      />
    </svg>
  );
}
