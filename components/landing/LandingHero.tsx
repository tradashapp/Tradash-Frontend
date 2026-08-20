"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { LandingHeader } from "./LandingHeader";
import { LandingFooter } from "./LandingFooter";
import { PhoneMockup } from "./PhoneMockup";
import { DemoScreen } from "./DemoScreen";
import { DemoToast } from "./DemoToast";
import { InstallSheet } from "@/components/sheets/InstallSheet";
import { useDemoTrade } from "@/hooks/useDemoTrade";
import { initSound, playSound, unlockSound } from "@/lib/sound";
import type { ChartFrame } from "@/lib/chart/engine";

// One-screen hero: grid background, transparent header, headline, Get Started
// pill, and the live phone demo. Header and footer are fixed; the hero column
// scrolls only if the viewport is too short for the phone.
export function LandingHero() {
  const [installOpen, setInstallOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const gridRef = useRef<DotGridHandle | null>(null);

  // The landing page mounts outside the app's provider tree, so the sound
  // engine is initialised here. Unmuted by default — the demo's SFX are the
  // point — but nothing can actually play until a gesture unlocks audio.
  useEffect(() => {
    initSound(() => true);
  }, []);

  // Pause the simulation while the tab is hidden so it isn't burning a rAF loop
  // (and firing sounds) in a background tab.
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const demo = useDemoTrade(visible);

  // The page's own background grid drifts gently on its own — it isn't wired to
  // the demo chart (that grid lives inside the phone), so it gets a slow idle
  // scroll to keep the backdrop alive.
  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    const idle: ChartFrame = { price: null, yNorm: 0.5, velocity: 0, scrollX: 0.35 };
    const tick = () => {
      gridRef.current?.react(idle);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  const fade = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 18 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <main className="landing-root relative h-dvh w-full overflow-hidden bg-bg">
      {/* Same dot grid as the chart background. */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <DotGrid ref={gridRef} ignoreSplash />
      </div>
      {/* Vignette keeps the headline legible over the grid. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1]"
        style={{
          background:
            "radial-gradient(80% 60% at 50% 40%, transparent 30%, rgba(8,9,12,0.75) 100%)",
        }}
      />

      <LandingHeader onInstall={() => setInstallOpen(true)} />

      {/* Hero column. Header/footer are fixed, so the padding here reserves
          their space and the phone centres in what's left. */}
      <div className="relative z-10 flex h-full flex-col items-center overflow-y-auto px-5 pb-24 pt-24 sm:pb-28 sm:pt-28">
        <motion.h1
          {...fade(0.05)}
          className="text-center text-[2rem] font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
        >
          One Tap<span className="text-up">✦</span> Away From
          <br />
          Glory
        </motion.h1>

        <motion.div {...fade(0.15)} className="mt-6 sm:mt-7">
          <Link
            href="/trade"
            onClick={() => {
              unlockSound();
              playSound("tap");
            }}
            className="group inline-flex items-center gap-2 rounded-full bg-up px-7 py-3.5 text-base font-bold text-black transition-transform duration-200 ease-snap hover:scale-[1.04] active:scale-95"
          >
            Get Started
            <HugeiconsIcon
              icon={ArrowRight01Icon}
              size={18}
              className="transition-transform duration-200 group-hover:translate-x-0.5"
            />
          </Link>
        </motion.div>

        <motion.div
          {...fade(0.25)}
          className="relative mt-8 shrink-0 sm:mt-10"
        >
          <PhoneMockup>
            <DemoScreen demo={demo} />
            <DemoToast lastClose={demo.lastClose} />
          </PhoneMockup>
        </motion.div>
      </div>

      <LandingFooter />

      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
    </main>
  );
}
