"use client";

import { useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, ChampionIcon } from "@hugeicons/core-free-icons";
import { usePoints } from "@/hooks/usePoints";
import { formatPoints } from "@/lib/format";
import { compactUsd, multiplierText, POINTS_DISCLAIMER } from "@/lib/points";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { MenuSection } from "@/components/ui/MenuSection";
import { InfoTip } from "@/components/ui/InfoTip";

// Points, kept to numbers: total and rank, this week, the referral tier with
// progress to the next one, and any market boosts. How points are earned sits
// behind the "?" tips; every figure and rule comes from the backend.

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function PointsPanel({ onOpenBoard }: { onOpenBoard: () => void }) {
  const { data, loading, refresh } = usePoints();

  // Points move as the user trades, so opening the panel re-reads them.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!data) {
    return loading ? (
      <div className="flex flex-col gap-3">
        <div className="glass-inset h-[120px] animate-pulse rounded-2xl" />
        <div className="glass-inset h-[96px] animate-pulse rounded-2xl" />
      </div>
    ) : (
      <p className="py-10 text-center text-sm text-text-muted">Couldn&apos;t load points. Try again in a moment.</p>
    );
  }

  const { rules } = data;
  const next = data.nextTier;
  const prevMin = [...data.tiers].reverse().find((t) => t.minVolume <= data.referralVolume)?.minVolume ?? 0;
  const progress = next ? Math.min(1, (data.referralVolume - prevMin) / (next.minVolume - prevMin)) : 1;

  return (
    <div className="flex flex-col">
      {/* Total + rank */}
      <div className="glass-inset mb-3 rounded-2xl p-4">
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          Your points
          <InfoTip label="How points work">
            1 point per {compactUsd(rules.usdPerPoint)} traded, opens and closes. Fee-free and bot volume counts{" "}
            {Math.round(rules.reducedWeight * 100)}%. Referral tiers and market boosts multiply it, up to{" "}
            {multiplierText(rules.maxMultiplier)}. Weeks start Monday 00:00 UTC. {POINTS_DISCLAIMER}
          </InfoTip>
        </div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <span className="tabular text-3xl font-bold leading-none">{formatPoints(data.points)}</span>
          <span className="tabular text-sm text-text-muted">
            {data.rank > 0 ? (
              <>
                <span className="font-semibold text-text">#{data.rank}</span> of {data.traders}
              </>
            ) : (
              "Unranked"
            )}
          </span>
        </div>
      </div>

      {/* Numbers */}
      <div className="glass-inset mb-3 flex gap-2 rounded-2xl p-2">
        <Stat label="This week" value={formatPoints(data.weekPoints)} accent={data.weekPoints > 0} />
        <Stat label="Multiplier" value={multiplierText(data.referralMultiplier)} accent={data.referralMultiplier > 1} />
        <Stat label="Volume" value={compactUsd(data.volume)} />
      </div>

      {/* Referral tier */}
      <MenuSection title="Referral tier" className="mb-3">
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1">
              <span className="tabular font-semibold">{compactUsd(data.referralVolume)}</span>
              <span className="text-text-muted">referred</span>
              <InfoTip label="About referral tiers">
                Volume traded by people who joined with your link. Higher tiers multiply all your points.
              </InfoTip>
            </span>
            {next ? (
              <span className="tabular text-xs text-text-muted">
                {compactUsd(next.minVolume)} → <span className="text-up">{multiplierText(next.multiplier)}</span>
              </span>
            ) : (
              <span className="text-xs text-up">Top tier</span>
            )}
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-up transition-[width] duration-500" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.tiers.map((t) => {
              const reached = data.referralVolume >= t.minVolume;
              return (
                <span
                  key={t.minVolume}
                  className={`tabular rounded-full px-2 py-0.5 text-[11px] ${
                    reached ? "bg-up-soft text-up" : "bg-white/[0.04] text-text-muted"
                  }`}
                >
                  {compactUsd(t.minVolume)} · {multiplierText(t.multiplier)}
                </span>
              );
            })}
          </div>
        </div>
      </MenuSection>

      {/* Market boosts */}
      {data.boosts.length > 0 && (
        <MenuSection title="Boosts" className="mb-3">
          {data.boosts.map((b) => {
            const live = new Date(b.startsAt).getTime() <= Date.now();
            return (
              <div key={`${b.symbol}-${b.startsAt}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="flex-1 font-medium">{b.symbol}</span>
                <span className="text-xs text-text-muted">
                  {live ? (b.endsAt ? `until ${shortDate(b.endsAt)}` : "live") : `from ${shortDate(b.startsAt)}`}
                </span>
                <span className="tabular w-12 text-right font-semibold text-up">+{multiplierText(b.multiplier - 1)}</span>
              </div>
            );
          })}
        </MenuSection>
      )}

      <MenuSection className="mb-2">
        <button
          type="button"
          onClick={() => {
            playSound("tap");
            haptic("tap");
            onOpenBoard();
          }}
          className="flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/[0.06]"
        >
          <HugeiconsIcon icon={ChampionIcon} size={18} className="shrink-0 text-text-muted" />
          <span className="flex-1 text-left">Points leaderboard</span>
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="shrink-0 text-text-muted" />
        </button>
      </MenuSection>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-white/[0.02] px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className={`tabular truncate text-sm font-semibold ${accent ? "text-up" : ""}`}>{value}</div>
    </div>
  );
}

/** The account menu row's detail text. */
export function usePointsDetail(): string | undefined {
  const { data } = usePoints();
  if (!data || data.points === 0) return undefined;
  return `${formatPoints(data.points)} pts`;
}
