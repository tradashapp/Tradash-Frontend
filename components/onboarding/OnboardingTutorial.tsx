"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChartLineData01Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  Coins01Icon,
  ArrowMoveUpRightIcon,
  Cancel01Icon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";
import { useAppDispatch } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { setMode } from "@/store/slices/tradingModeSlice";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { StepArt } from "./StepArt";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Step {
  icon: typeof ChartLineData01Icon;
  title: string;
  body: string;
  art: "chart" | "updown" | "pnl" | "trail" | "close";
}

const STEPS: Step[] = [
  {
    icon: ChartLineData01Icon,
    title: "Watch the market",
    body: "A live, buttery-smooth price chart is always front and center. That's your whole workspace — no forms, no clutter.",
    art: "chart",
  },
  {
    icon: ArrowUp01Icon,
    title: "Tap UP or DOWN",
    body: "Think price goes up? Tap UP to go long. Think it drops? Tap DOWN to go short. One tap opens a leveraged position instantly.",
    art: "updown",
  },
  {
    icon: Coins01Icon,
    title: "Watch your PnL move",
    body: "Your profit or loss updates live on the price line as the market moves — green when you're up, red when you're down.",
    art: "pnl",
  },
  {
    icon: ArrowMoveUpRightIcon,
    title: "Trail to lock profit",
    body: "Once you're in profit, tap Trail. It follows the price up and auto-closes if it reverses — locking in your gains for you.",
    art: "trail",
  },
  {
    icon: Cancel01Icon,
    title: "Close to bank it",
    body: "Tap Close anytime to take your profit (or cut a loss). That's the whole loop — watch, tap, manage, close.",
    art: "close",
  },
];

// First-run "how it works" walkthrough. Multi-step, swipeable feel, with back/
// next and a final Try Demo / Try Live choice. Also replayable from the menu.
export function OnboardingTutorial({ open, onClose }: Props) {
  const dispatch = useAppDispatch();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1); // slide direction
  const isLast = i === STEPS.length - 1;

  const markSeen = () => dispatch(updateSettings({ tutorialSeen: true }));

  const go = (next: number) => {
    setDir(next > i ? 1 : -1);
    setI(next);
    playSound("tap");
    haptic("tap");
  };

  const finish = (mode: "demo" | "live") => {
    dispatch(setMode(mode));
    markSeen();
    playSound("tap");
    haptic("tap");
    onClose();
    setTimeout(() => setI(0), 300); // reset for next replay
  };

  const skip = () => {
    markSeen();
    onClose();
    setTimeout(() => setI(0), 300);
  };

  const step = STEPS[i]!;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Dim + glass backdrop */}
          <div className="glass absolute inset-0" />

          {/* Top bar: back + skip + progress dots.

              This is a full-screen `fixed inset-0` overlay, not a sheet, so
              nothing above it reserves the status bar: in an installed PWA the
              page owns the whole screen and a flat `pt-6` put the back chevron,
              the progress dots and the Skip button underneath the clock and
              battery. The inset is added to that padding so the row clears the
              status bar; in a browser the inset is 0 and this stays the original
              24px. */}
          <div className="relative z-10 flex items-center justify-between px-5 pt-[calc(env(safe-area-inset-top)+1.5rem)]">
            <button
              type="button"
              onClick={() => (i === 0 ? skip() : go(i - 1))}
              className="flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-text active:scale-90"
              aria-label={i === 0 ? "Skip" : "Back"}
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
            </button>

            <div className="flex gap-1.5">
              {STEPS.map((_, idx) => (
                <span
                  key={idx}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    idx === i ? "w-6 bg-up" : "w-1.5 bg-white/20"
                  }`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={skip}
              className="text-sm font-medium text-text-muted transition-colors hover:text-text"
            >
              Skip
            </button>
          </div>

          {/* Step content */}
          <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={i}
                initial={{ opacity: 0, x: dir * 60 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -60 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="flex w-full max-w-sm flex-col items-center text-center"
              >
                {/* Mini on-brand mockup */}
                <StepArt art={step.art} />

                <div className="mt-8 flex items-center gap-2">
                  <HugeiconsIcon icon={step.icon} size={22} className="text-up" />
                  <span className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                    Step {i + 1}
                  </span>
                </div>
                <h2 className="mt-2 text-2xl font-bold">{step.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-text-muted">
                  {step.body}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Bottom actions. Same full-screen caveat as the top bar — the
              buttons have to clear the home indicator themselves. `max()` keeps
              the generous 40px the browser gets while letting the PWA's ~34px
              inset stand in for it rather than stacking on top.
              pb-[max(env(safe-area-inset-bottom),2.5rem)]
               */}
          <div className="relative z-10 px-6">
            {!isLast ? (
              <button
                type="button"
                onClick={() => go(i + 1)}
                className="w-full rounded-2xl bg-up py-4 text-lg font-semibold text-black transition-transform active:scale-95"
              >
                Next
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => finish("demo")}
                  className="w-full rounded-2xl bg-up py-4 text-lg font-semibold text-black transition-transform active:scale-95"
                >
                  Try Demo
                </button>
                <button
                  type="button"
                  onClick={() => finish("live")}
                  className="glass-inset w-full rounded-2xl py-4 text-lg font-semibold text-text transition-transform active:scale-95"
                >
                  Try Live
                </button>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
