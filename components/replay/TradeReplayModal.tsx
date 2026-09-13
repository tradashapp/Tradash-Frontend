"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  PlayIcon,
  PauseIcon,
  RefreshIcon,
  Share05Icon,
} from "@hugeicons/core-free-icons";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { Odometer } from "@/components/ui/Odometer";
import { ReplayChart } from "./ReplayChart";
import { buildTimeline, indexAt, priceAtIndex, progressAtTime } from "@/lib/replay/playback";
import { coverageLabel } from "@/lib/replay/path";
import { formatUsd } from "@/lib/format";
import { MARKETS } from "@/lib/markets";
import type { ChartFrame, PositionOverlay } from "@/lib/chart/engine";
import type { CompletedTrade, TradeEpisode } from "@/types";

interface Props {
  /** The recording to play, and the row it was opened from. */
  subject: { episode: TradeEpisode; trade: CompletedTrade } | null;
  onClose: () => void;
  /** Hand off to the existing PnL share card. */
  onShare: (trade: CompletedTrade) => void;
}

export function TradeReplayModal({ subject, onClose, onShare }: Props) {
  return (
    <AnimatePresence>
      {subject && (
        <ReplayInner
          key={subject.episode.id}
          episode={subject.episode}
          trade={subject.trade}
          onClose={onClose}
          onShare={onShare}
        />
      )}
    </AnimatePresence>
  );
}

function ReplayInner({
  episode,
  trade,
  onClose,
  onShare,
}: {
  episode: TradeEpisode;
  trade: CompletedTrade;
  onClose: () => void;
  onShare: (trade: CompletedTrade) => void;
}) {
  const timeline = useMemo(() => buildTimeline(episode), [episode]);
  const gridRef = useRef<DotGridHandle | null>(null);

  // Playback progress lives in state because the whole readout (price, PnL,
  // scrubber) is derived from it. The chart is re-seeded per change rather than
  // pushed per frame, which is what makes scrubbing backwards work.
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [scrubbing, setScrubbing] = useState(false);

  // Opening from a specific history row starts at that row's moment, so tapping
  // a "Reduce" row lands on the reduce rather than replaying from the top.
  useEffect(() => {
    const isClose = (trade.kind ?? "close") === "close";
    if (isClose) return;
    const at = progressAtTime(timeline, trade.closedAt);
    // Rewind a beat so the run-up to the event is visible, not just the moment.
    setProgress(Math.max(0, at - 0.12));
  }, [timeline, trade]);

  // Playback clock.
  useEffect(() => {
    if (!playing || scrubbing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      setProgress((p) => {
        const next = p + dt / timeline.durationMs;
        if (next >= 1) {
          setPlaying(false);
          return 1;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, scrubbing, timeline.durationMs]);

  const handleFrame = useCallback((f: ChartFrame) => {
    gridRef.current?.react(f);
  }, []);

  // Everything shown is derived from the replayed price at this instant.
  const index = indexAt(timeline, progress);
  const price = priceAtIndex(timeline, index);
  const dir = episode.direction === "long" ? 1 : -1;
  // PnL is reconstructed from the recorded price against the break-even line —
  // the same relationship the live chart draws, so the replay's colors and the
  // original screen agree.
  const size = trade.size || 0;
  const pnl = (price - episode.entryLine) * dir * size;

  const overlay: PositionOverlay = {
    entryPrice: episode.entryLine,
    liquidationPrice: episode.liqLine ?? episode.entryLine,
    pnl,
  };

  const market = MARKETS[episode.symbol];
  const win = pnl >= 0;
  const speed = Math.max(1, Math.round(timeline.speed));
  const replay = () => {
    setProgress(0);
    setPlaying(true);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        className="glass relative z-10 flex h-full w-full max-w-md flex-col overflow-hidden sm:h-[92dvh] sm:rounded-3xl"
        initial={{ scale: 0.96, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.97, y: 10, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
      >
        {/* Header — mirrors the real trade screen's chrome.

            On a phone this modal is full-bleed (`h-full w-full`, no rounding),
            so in an installed PWA it runs behind the status bar and a flat
            `pt-3` hid the price pill and the close button under the clock. The
            inset is added here the same way the live trade screen's header does
            it. From `sm:` up the modal is an inset card with the page visible
            around it, so the inset is no longer the modal's problem — but it
            also reports 0 on those viewports, so one expression covers both. */}
        <header className="relative z-20 flex items-start justify-between px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:pt-3">
          <div className="flex items-center gap-2 rounded-full bg-bg-overlay/50 px-1.5 py-1">
            {market && (
              <Image
                src={market.logo}
                alt={market.label}
                width={40}
                height={40}
                className="h-6 w-6 rounded-full"
              />
            )}
            <div className="leading-tight">
              <Odometer value={formatUsd(price)} className="text-[13px] font-semibold" />
              <div className="text-[9px] text-text-muted">
                {episode.symbol} · {episode.direction === "long" ? "Long" : "Short"} ·{" "}
                {trade.leverage}×
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-semibold tabular text-text-muted">
              {speed}×
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-text"
              aria-label="Close replay"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={20} />
            </button>
          </div>
        </header>

        {/* Chart — same engine, same dot grid as the live screen. */}
        <div className="relative flex-1">
          <div className="pointer-events-none absolute inset-0 z-0">
            <DotGrid ref={gridRef} ignoreSplash />
          </div>
          <div className="absolute inset-0 z-10">
            <ReplayChart
              timeline={timeline}
              progress={progress}
              position={overlay}
              onFrame={handleFrame}
            />
          </div>

          {/* Live PnL readout — the emotional payload of the replay. */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-20">
            <div className="text-[10px] text-text-muted">Unrealized</div>
            <Odometer
              value={`${win ? "+" : "−"}${formatUsd(Math.abs(pnl))}`}
              className={`text-2xl font-bold ${win ? "text-up" : "text-down"}`}
            />
          </div>
        </div>

        {/* Scrubber + transport. Full-bleed on a phone (see the header note),
            so the transport row carries its own home-indicator clearance:
            `max()` keeps the browser's 20px and lets the PWA's larger inset
            replace it instead of adding to it. Reset at `sm:`, where the modal
            is an inset card.
             pb-[max(env(safe-area-inset-bottom),1rem)]
             */}
        <div className="relative z-20 flex flex-col gap-3 px-4 pt-3 sm:pb-5">
          <div className="relative">
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(progress * 1000)}
              onChange={(e) => setProgress(Number(e.target.value) / 1000)}
              onPointerDown={() => setScrubbing(true)}
              onPointerUp={() => setScrubbing(false)}
              onPointerCancel={() => setScrubbing(false)}
              className="w-full accent-up"
              aria-label="Replay position"
            />
            {/* Event markers: where size was added, reduced, and the close. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1.5">
              {timeline.beats
                .filter((b) => b.kind !== "entry" && b.kind !== "exit")
                .map((b, i) => (
                  <span
                    key={i}
                    className="absolute h-1.5 w-0.5 -translate-x-1/2 rounded bg-white/50"
                    style={{ left: `${b.at * 100}%` }}
                    title={b.kind}
                  />
                ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (progress >= 1 ? replay() : setPlaying((p) => !p))}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-text transition-colors hover:bg-white/20"
              aria-label={progress >= 1 ? "Replay" : playing ? "Pause" : "Play"}
            >
              <HugeiconsIcon
                icon={progress >= 1 ? RefreshIcon : playing ? PauseIcon : PlayIcon}
                size={18}
              />
            </button>

            <div className="flex-1 leading-tight">
              <div className="text-[11px] text-text-muted">
                {fmtDuration(trade.durationMs)} · {coverageLabel(episode)}
              </div>
              <div className={`text-sm font-semibold ${trade.pnl >= 0 ? "text-up" : "text-down"}`}>
                Closed {trade.pnl >= 0 ? "+" : "−"}
                {formatUsd(Math.abs(trade.pnl))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onShare(trade)}
              className="flex items-center gap-1.5 rounded-xl bg-up px-4 py-2.5 text-sm font-bold text-bg transition-opacity hover:opacity-90"
            >
              <HugeiconsIcon icon={Share05Icon} size={16} />
              Share
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}
