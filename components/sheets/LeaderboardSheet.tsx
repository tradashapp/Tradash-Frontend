"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Filters } from "@/components/leaderboard/Filters";
import { Podium } from "@/components/leaderboard/Podium";
import { LeaderboardTable } from "@/components/leaderboard/LeaderboardTable";
import { TraderProfileModal } from "@/components/leaderboard/TraderProfileModal";
import { useLeaderboard } from "@/hooks/useLeaderboard";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type {
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardPeriod,
} from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Return to wherever the leaderboard was opened from (the account sheet).
   * Optional — without it the sheet only offers close, which is right for a
   * caller that opened it from nowhere in particular.
   */
  onBack?: () => void;
}

/** How many traders the board lists. */
const LEADERBOARD_SIZE = 10;

/**
 * The leaderboard: filters at the top, the top-3 podium beneath them, then the
 * ranked table with the user's own row pinned to the bottom.
 *
 * `scrollBody={false}` — the table owns its own scroll region so that the
 * filters and podium stay put while the ranks scroll under them, and so the
 * pinned "you" row has a scroll container to anchor to.
 */
export function LeaderboardSheet({ open, onClose, onBack }: Props) {
  // ROI leads: it ranks on skill rather than on who deposited the most.
  const [metric, setMetric] = useState<LeaderboardMetric>("roi");
  const [period, setPeriod] = useState<LeaderboardPeriod>("all");
  const [subject, setSubject] = useState<LeaderboardEntry | null>(null);

  const { board, loading, error, refresh } = useLeaderboard(
    metric,
    period,
    open
  );

  // Only the top LEADERBOARD_SIZE are listed; a signed-in user below that sees
  // their own row pinned under the table instead (LeaderboardTable).
  const entries = (board?.entries ?? []).slice(0, LEADERBOARD_SIZE);
  // The podium highlights the top three; the table still lists the full 1-10,
  // so the ranks read as one continuous column rather than starting at 4.
  const top3 = entries.slice(0, 3);

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        onBack={onBack}
        title="Leaderboard"
        scrollBody={false}
        header={
          <Filters
            metric={metric}
            period={period}
            onMetric={setMetric}
            onPeriod={setPeriod}
          />
        }
      >
        {error ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3">
            <p className="text-sm text-text-muted">
              Couldn&rsquo;t load the leaderboard.
            </p>
            <button
              type="button"
              onClick={() => {
                playSound("tap");
                haptic("tap");
                refresh();
              }}
              className="rounded-full bg-up px-5 py-2 text-sm font-bold text-black transition-transform active:scale-95"
            >
              Try again
            </button>
          </div>
        ) : loading && !board ? (
          <Skeleton />
        ) : (
          <>
            <Podium top={top3} metric={metric} onSelect={setSubject} />
            <LeaderboardTable
              entries={entries}
              me={board?.me ?? null}
              metric={metric}
              onSelect={setSubject}
            />
          </>
        )}
      </Sheet>

      <TraderProfileModal
        subject={subject}
        period={period}
        onClose={() => setSubject(null)}
      />
    </>
  );
}

/** Podium + rows in outline, so switching filters doesn't collapse the sheet. */
function Skeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-5 flex items-end justify-center gap-2 pt-10">
        <div className="h-[78px] flex-1 rounded-t-2xl bg-white/[0.05]" />
        <div className="h-[104px] flex-1 -translate-y-3 rounded-t-2xl bg-white/[0.07]" />
        <div className="h-[64px] flex-1 translate-y-1 rounded-t-2xl bg-white/[0.04]" />
      </div>
      <div className="flex flex-col gap-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-11 rounded-xl bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}
