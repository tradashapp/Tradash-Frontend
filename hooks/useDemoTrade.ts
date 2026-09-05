"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SimFeed } from "@/lib/landing/simFeed";
import {
  AUTO_PRESS_MS,
  COOLDOWN_MS,
  DEMO_LEVERAGE,
  DEMO_MARGIN,
  DEMO_SIZE,
  IDLE_DELAY_MS,
  MIN_HOLD_MS,
  TARGET_PNL,
  demoLiquidation,
  demoPnl,
  driftFor,
  inPullback,
  type Direction,
  type DemoPhase,
} from "@/lib/landing/demoMachine";
import { playSound, playCloseOutcome, unlockSound } from "@/lib/sound";
import type { PositionOverlay } from "@/lib/chart/engine";

export interface DemoPosition {
  direction: Direction;
  entryPrice: number;
  pnl: number;
  liquidationPrice: number;
}

export interface DemoClose {
  /** Bumped on every close so the toast layer can react to a fresh event. */
  id: number;
  direction: Direction;
  pnl: number;
}

export interface DemoTrade {
  price: number;
  phase: DemoPhase;
  position: DemoPosition | null;
  /** Which button is showing a synthetic press (idle path), if any. */
  autoPressing: Direction | null;
  /** Last close, for the toast. */
  lastClose: DemoClose | null;
  chartPosition: PositionOverlay | null;
  balance: number;
  openLong: () => void;
  openShort: () => void;
}

const START_PRICE = 111_842.6;
const START_BALANCE = 1_000;

/**
 * Runs the landing-page trading demo: a simulated feed, a position lifecycle,
 * and the sounds/toasts the real app fires — without touching Redux, Privy, the
 * oracle or Bulk. The whole thing lives in refs and a single rAF loop, so the
 * 60fps price updates never re-render React; only lifecycle changes (phase,
 * open/close) and the throttled PnL readout do.
 */
export function useDemoTrade(active: boolean): DemoTrade {
  const feedRef = useRef<SimFeed | null>(null);
  if (!feedRef.current) feedRef.current = new SimFeed({ start: START_PRICE });

  const [price, setPrice] = useState(START_PRICE);
  const [phase, setPhase] = useState<DemoPhase>("flat");
  const [position, setPosition] = useState<DemoPosition | null>(null);
  const [autoPressing, setAutoPressing] = useState<Direction | null>(null);
  const [lastClose, setLastClose] = useState<DemoClose | null>(null);
  const [balance, setBalance] = useState(START_BALANCE);

  // Mirror of the lifecycle in refs, so the rAF loop reads current values
  // without being re-created (which would restart the animation every tick).
  const phaseRef = useRef<DemoPhase>("flat");
  const posRef = useRef<DemoPosition | null>(null);
  const openedAtRef = useRef(0);
  const flatSinceRef = useRef(performance.now());
  const cooldownUntilRef = useRef(0);
  const closeIdRef = useRef(0);
  // Once the user drives the demo themselves, the idle auto-trade stops
  // hijacking the mockup.
  const userEngagedRef = useRef(false);
  // Profit-sound milestones: one chime per $10 of gain, like the app's ticker.
  const profitAnchorRef = useRef(0);

  const setPhaseBoth = useCallback((p: DemoPhase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const open = useCallback(
    (direction: Direction, synthetic: boolean) => {
      const feed = feedRef.current!;
      const entry = feed.getPrice();
      const next: DemoPosition = {
        direction,
        entryPrice: entry,
        pnl: 0,
        liquidationPrice: demoLiquidation(direction, entry),
      };
      posRef.current = next;
      setPosition(next);
      openedAtRef.current = performance.now();
      profitAnchorRef.current = 0;
      setPhaseBoth("open");
      if (!synthetic) unlockSound();
      playSound("open");
    },
    [setPhaseBoth]
  );

  const close = useCallback(() => {
    const pos = posRef.current;
    if (!pos) return;
    closeIdRef.current += 1;
    const booked = pos.pnl;
    setLastClose({ id: closeIdRef.current, direction: pos.direction, pnl: booked });
    setBalance((b) => b + booked);
    posRef.current = null;
    setPosition(null);
    feedRef.current!.setDrift(0);
    feedRef.current!.setCalm(0);
    setPhaseBoth("closing");
    playCloseOutcome(booked);

    cooldownUntilRef.current = performance.now() + COOLDOWN_MS;
    window.setTimeout(() => {
      flatSinceRef.current = performance.now();
      setPhaseBoth("flat");
    }, 700);
  }, [setPhaseBoth]);

  // Public tap handlers. A real tap cancels any pending auto-press and marks the
  // user as engaged so the demo stops driving itself.
  const tap = useCallback(
    (direction: Direction) => {
      if (phaseRef.current !== "flat") return;
      if (performance.now() < cooldownUntilRef.current) return;
      userEngagedRef.current = true;
      setAutoPressing(null);
      open(direction, false);
    },
    [open]
  );

  const openLong = useCallback(() => tap("long"), [tap]);
  const openShort = useCallback(() => tap("short"), [tap]);

  // The single rAF loop: advance the feed, apply steering, update PnL, and run
  // the idle → auto-press → open → close cycle.
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let lastPnlPush = 0;
    let pressTimer = 0;

    const loop = () => {
      const feed = feedRef.current!;
      const now = performance.now();
      const pos = posRef.current;

      if (pos) {
        const elapsed = now - openedAtRef.current;
        feed.setDrift(driftFor(pos.direction, elapsed));
        // Damp the noise slightly during a retrace so the pullback reads as a
        // deliberate breather rather than a volatility spike.
        feed.setCalm(inPullback(elapsed) ? 0.45 : 0);
      }

      const p = feed.tick();

      // Price drives a canvas engine imperatively, so React only needs it at a
      // readable cadence — not every frame.
      if (now - lastPnlPush > 90) {
        lastPnlPush = now;
        setPrice(p);
        if (posRef.current) {
          const pnl = demoPnl(
            posRef.current.direction,
            posRef.current.entryPrice,
            p
          );
          posRef.current = { ...posRef.current, pnl };
          setPosition(posRef.current);
          // One chime per $10 climbed, never on the way down.
          if (pnl - profitAnchorRef.current >= 10) {
            profitAnchorRef.current = pnl;
            playSound("profit");
          } else if (pnl < profitAnchorRef.current) {
            profitAnchorRef.current = Math.max(0, pnl);
          }
        }
      }

      // Auto-close once the position has run long enough and hit the target.
      if (
        posRef.current &&
        phaseRef.current === "open" &&
        now - openedAtRef.current > MIN_HOLD_MS &&
        posRef.current.pnl >= TARGET_PNL
      ) {
        close();
      }

      // Idle path: nobody has tapped, so the demo taps for itself.
      if (
        phaseRef.current === "flat" &&
        !userEngagedRef.current &&
        now > cooldownUntilRef.current &&
        now - flatSinceRef.current > IDLE_DELAY_MS &&
        !pressTimer
      ) {
        // Alternate direction each cycle so the demo shows both sides.
        const direction: Direction =
          closeIdRef.current % 2 === 0 ? "long" : "short";
        setAutoPressing(direction);
        setPhaseBoth("autoPress");
        pressTimer = window.setTimeout(() => {
          pressTimer = 0;
          setAutoPressing(null);
          open(direction, true);
        }, AUTO_PRESS_MS);
      }

      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (pressTimer) window.clearTimeout(pressTimer);
    };
  }, [active, close, open, setPhaseBoth]);

  const chartPosition: PositionOverlay | null = position
    ? {
        entryPrice: position.entryPrice,
        liquidationPrice: position.liquidationPrice,
        pnl: position.pnl,
      }
    : null;

  return {
    price,
    phase,
    position,
    autoPressing,
    lastClose,
    chartPosition,
    balance,
    openLong,
    openShort,
  };
}

export { DEMO_LEVERAGE, DEMO_MARGIN, DEMO_SIZE };
