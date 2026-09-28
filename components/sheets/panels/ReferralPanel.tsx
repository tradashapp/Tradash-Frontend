"use client";

import { useEffect, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  Share08Icon,
} from "@hugeicons/core-free-icons";
import { useReferral } from "@/hooks/useReferral";
import { referralLink } from "@/lib/config";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { MenuSection } from "@/components/ui/MenuSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { Avatar } from "@/components/leaderboard/Avatar";

// Referrals, kept to what a trader needs: their link, three numbers, and who
// joined. Every percentage comes from the backend (the admin sets them); the
// explanations of what they apply to sit behind the small "?" tips.

const COPIED_MS = 1600;

/** Earnings in cents; a real but sub-cent amount isn't shown as $0.00. */
function money(v: number): string {
  if (v > 0 && v < 0.01) return "<$0.01";
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactUsd(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e4) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** 2 bps → "0.02%". */
const feePct = (bps: number) => `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
const pct = (v: number) => `${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

export function ReferralPanel() {
  const { data, loading, apply, refresh } = useReferral();
  const [copied, setCopied] = useState(false);

  // Earnings move as referrals trade, so opening the panel re-reads them.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  if (!data) {
    return loading ? (
      <div className="flex flex-col gap-3">
        <div className="glass-inset h-[132px] animate-pulse rounded-2xl" />
        <div className="glass-inset h-[64px] animate-pulse rounded-2xl" />
      </div>
    ) : (
      <p className="py-10 text-center text-sm text-text-muted">Couldn&apos;t load referrals. Try again in a moment.</p>
    );
  }

  const link = data.code ? referralLink(data.code) : null;
  const shown = link?.replace(/^https?:\/\/(www\.)?/, "");
  const sharing = data.enabled && data.codeActive && !!link;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const copy = async () => {
    if (!link) return;
    playSound("tap");
    haptic("tap");
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const share = async () => {
    if (!link) return;
    playSound("tap");
    haptic("tap");
    try {
      await navigator.share({ title: "Tradash", text: `Trade on Tradash and save ${pct(data.rebatePct)} on fees.`, url: link });
    } catch {
      // Dismissed, or unsupported after all.
    }
  };

  return (
    <div className="flex flex-col">
      {/* Link */}
      {sharing ? (
        <div className="glass-inset mb-3 rounded-2xl p-4">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold">Earn {pct(data.rewardPct)} of their fees</span>
            <InfoTip label="How referral rewards work">
              When someone joins with your link, you earn {pct(data.rewardPct)} of the Tradash fee on their trades, and
              they get {pct(data.rebatePct)} back. The Tradash fee is {feePct(data.builderFeeBps)} of each trade
              you open; Bulk&apos;s exchange fee isn&apos;t included. New accounts only.
            </InfoTip>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={copy}
              aria-label="Copy referral link"
              title={link ?? undefined}
              className="glass-inset flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] active:scale-[0.99]"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{shown}</span>
              <HugeiconsIcon
                icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
                size={16}
                className={`shrink-0 ${copied ? "text-up" : "text-text-muted"}`}
              />
            </button>
            {canShare && (
              <button
                type="button"
                onClick={share}
                aria-label="Share referral link"
                className="flex w-11 shrink-0 items-center justify-center rounded-xl bg-up text-black transition-transform active:scale-95"
              >
                <HugeiconsIcon icon={Share08Icon} size={18} />
              </button>
            )}
          </div>
          <p className="mt-2 h-4 text-xs text-text-muted" role="status" aria-live="polite">
            {copied ? <span className="text-up">Link copied</span> : <>Code <span className="font-mono text-text">{data.code}</span></>}
          </p>
        </div>
      ) : (
        <p className="glass-inset mb-3 rounded-2xl px-4 py-3 text-sm text-text-muted">
          {data.enabled ? "Your referral link is unavailable." : "Referrals are paused."}
        </p>
      )}

      {/* Numbers */}
      <div className="glass-inset mb-4 flex gap-2 rounded-2xl p-2">
        <Stat label="Referrals" value={String(data.stats.referrals)} />
        <Stat label="Volume" value={compactUsd(data.stats.volume)} />
        <Stat
          label="Earned"
          value={money(data.stats.earned)}
          accent={data.stats.earned > 0}
          tip={
            <>
              Your share of the Tradash fees your referrals actually paid, added up as they trade. Paid out by
              Tradash.
            </>
          }
        />
      </div>

      {/* Your own referral: who invited you, or where to enter a code */}
      {data.referredBy ? (
        <MenuSection title="Invited by" className="mb-4">
          <div className="flex items-center gap-3 px-4 py-3">
            <Avatar src={data.referredBy.avatarUrl} name={data.referredBy.username} className="h-8 w-8 text-xs" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">
                {data.referredBy.username ? `@${data.referredBy.username}` : "A friend"}
              </div>
              <div className="flex items-center gap-1 text-xs text-text-muted">
                You save {pct(data.rebatePct)} on fees
                <InfoTip label="About your fee rebate">
                  {pct(data.rebatePct)} of the Tradash fee ({feePct(data.builderFeeBps)} of each trade you open) comes back
                  to you. Bulk&apos;s exchange fee isn&apos;t included.
                </InfoTip>
              </div>
            </div>
            <div className="text-right leading-tight">
              <div className="tabular text-sm font-semibold">{money(data.stats.saved)}</div>
              <div className="text-[11px] text-text-muted">saved</div>
            </div>
          </div>
        </MenuSection>
      ) : data.canApplyCode ? (
        <ApplyCode rebatePct={data.rebatePct} builderFeeBps={data.builderFeeBps} onApply={apply} />
      ) : null}

      {/* Who joined */}
      {data.referees.length > 0 && (
        <MenuSection title="Your referrals">
          {data.referees.map((r, i) => (
            <div key={`${r.username ?? ""}-${r.joinedAt}-${i}`} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar src={r.avatarUrl} name={r.username} className="h-7 w-7 text-[10px]" />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm">{r.username ? `@${r.username}` : "Trader"}</div>
                <div className="text-[11px] text-text-muted">
                  {r.active ? "Active" : "Inactive"} · joined {new Date(r.joinedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              </div>
              <div className="text-right leading-tight">
                <div className="tabular text-sm">{compactUsd(r.volume)}</div>
                <div className={`tabular text-[11px] ${r.earned > 0 ? "text-up" : "text-text-muted"}`}>+{money(r.earned)}</div>
              </div>
            </div>
          ))}
        </MenuSection>
      )}
    </div>
  );
}

function Stat({ label, value, accent, tip }: { label: string; value: string; accent?: boolean; tip?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl bg-white/[0.02] px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] text-text-muted">
        {label}
        {tip && <InfoTip size={12} label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>}
      </div>
      <div className={`tabular truncate text-sm font-semibold ${accent ? "text-up" : ""}`}>{value}</div>
    </div>
  );
}

function ApplyCode({
  rebatePct,
  builderFeeBps,
  onApply,
}: {
  rebatePct: number;
  builderFeeBps: number;
  onApply: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onApply(code.trim());
      haptic("tap");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply the code.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MenuSection title="Have a code?" className="mb-4">
      <div className="px-4 py-3.5">
        <div className="flex items-center gap-1 text-xs text-text-muted">
          Save {pct(rebatePct)} on fees with a referral
          <InfoTip label="About referral codes">
            {pct(rebatePct)} of the Tradash fee ({feePct(builderFeeBps)} of each trade you open) comes back to you. Bulk&apos;s
            exchange fee isn&apos;t included. Codes work before your first trade.
          </InfoTip>
        </div>
        <div className="mt-2.5 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
            placeholder="Referral code"
            maxLength={20}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="glass-inset min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none placeholder:text-text-muted/60"
          />
          <button
            type="button"
            disabled={busy || code.trim().length < 3}
            onClick={submit}
            className="rounded-xl bg-up px-4 text-sm font-bold text-black transition-transform active:scale-95 disabled:opacity-40"
          >
            {busy ? "…" : "Apply"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-down">{error}</p>}
      </div>
    </MenuSection>
  );
}

/** The account menu row's detail text, when there is something worth saying. */
export function useReferralDetail(): string | undefined {
  const { data } = useReferral();
  if (!data || !data.enabled) return undefined;
  if (data.stats.earned > 0) return `${money(data.stats.earned)} earned`;
  if (data.canApplyCode) return `Save ${pct(data.rebatePct)}`;
  return undefined;
}

