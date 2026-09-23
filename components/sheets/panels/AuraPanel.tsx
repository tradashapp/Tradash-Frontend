"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { SparklesIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { MenuSection } from "@/components/ui/MenuSection";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useAura } from "@/hooks/useAura";
import { describeAuraCategory, type Aura } from "@/lib/bulk/aura";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

/**
 * Bulk Aura — the wallet's points, league, rank, and where the points came from.
 *
 * Read-only and deliberately narrow: the indexer also returns referral and
 * deposit data, none of which is shown here (see lib/bulk/aura.ts).
 */

// Each league gets its own tint for the card glow and badge. Anything Bulk adds
// later falls back to the brand green rather than rendering colourless.
const LEAGUE_COLORS: Record<string, string> = {
  bronze: "#D08A4E",
  silver: "#C4CAD4",
  gold: "#F2C94C",
  platinum: "#8EE6DA",
  diamond: "#7CC4FF",
};
const BRAND = "#72E912";

const nf = new Intl.NumberFormat("en-US");

export function AuraPanel({ wallet }: { wallet: string | null }) {
  const { aura, loading, error, refresh } = useAura(wallet);

  if (error && !aura) {
    return (
      <div className="glass-inset flex flex-col items-center gap-3 rounded-2xl px-4 py-8 text-center">
        <p className="text-sm text-text-muted">Couldn&apos;t load your Aura.</p>
        <button
          type="button"
          onClick={() => {
            playSound("tap");
            haptic("tap");
            refresh();
          }}
          className="flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-semibold text-text transition-transform active:scale-95"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={14} />
          Try again
        </button>
      </div>
    );
  }

  const tint = aura?.league
    ? (LEAGUE_COLORS[aura.league.name.toLowerCase()] ?? BRAND)
    : BRAND;

  return (
    <div className="flex flex-col gap-4">
      <Hero aura={aura} loading={loading && !aura} tint={tint} />
      <Breakdown aura={aura} loading={loading && !aura} />
    </div>
  );
}

function Hero({
  aura,
  loading,
  tint,
}: {
  aura: Aura | null;
  loading: boolean;
  tint: string;
}) {
  return (
    <div className="glass-inset relative overflow-hidden rounded-2xl p-4">
      {/* League-tinted glow in the corner: the one flourish on the page, and
          it carries meaning — the colour IS the league. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full opacity-25 blur-3xl"
        style={{ background: tint }}
      />

      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <HugeiconsIcon icon={SparklesIcon} size={14} color={tint} />
            Aura points
          </span>
          {aura?.league && (
            <span
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
              style={{ color: tint, background: `${tint}1f` }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: tint }}
              />
              {aura.league.name}
            </span>
          )}
        </div>

        <div className="tabular mt-2 flex h-11 items-center text-4xl font-semibold">
          {loading ? (
            <SkeletonText width="6rem" size="xl" />
          ) : (
            nf.format(aura?.points ?? 0)
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <Stat
            label="Rank"
            loading={loading}
            value={aura?.rank != null ? `#${nf.format(aura.rank)}` : "—"}
          />
          <Stat
            label="Percentile"
            loading={loading}
            value={
              aura?.league
                ? `Top ${formatPercent(aura.league.percentile)}`
                : "Unranked"
            }
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
}: {
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="flex-1 rounded-xl bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="tabular flex h-5 items-center text-sm font-semibold">
        {loading ? <SkeletonText width="3.5rem" size="sm" /> : value}
      </div>
    </div>
  );
}

/**
 * Where the points came from, largest first. Each row carries a hairline bar
 * showing its share of the total, so the mix reads at a glance without a chart.
 */
function Breakdown({ aura, loading }: { aura: Aura | null; loading: boolean }) {
  const total = aura?.categories.reduce((s, c) => s + c.points, 0) ?? 0;

  return (
    <MenuSection title="Earned from">
      {loading ? (
        [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between px-4 py-3.5">
            <SkeletonText width="7rem" size="sm" />
            <SkeletonText width="2.5rem" size="sm" />
          </div>
        ))
      ) : !aura || aura.categories.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs leading-relaxed text-text-muted">
          No Aura yet. Trading on Bulk earns it weekly.
        </p>
      ) : (
        aura.categories.map((c) => {
          const { title, context } = describeAuraCategory(c.key);
          const share = total > 0 ? (c.points / total) * 100 : 0;
          return (
            <div key={c.key} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{title}</div>
                  {context && (
                    <div className="truncate text-[11px] text-text-muted">
                      {context}
                    </div>
                  )}
                </div>
                <span className="tabular shrink-0 text-sm font-semibold text-up">
                  +{nf.format(c.points)}
                </span>
              </div>
              <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full bg-up/70"
                  style={{ width: `${Math.max(share, 2)}%` }}
                />
              </div>
            </div>
          );
        })
      )}
    </MenuSection>
  );
}

/** 4.1859 → "4.19%"; whole numbers stay whole. */
function formatPercent(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return `${Number.isInteger(p) ? p : p.toFixed(2)}%`;
}
