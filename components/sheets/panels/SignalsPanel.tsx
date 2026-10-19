"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, Target02Icon } from "@hugeicons/core-free-icons";
import {
  api,
  type SignalAlert,
  type SignalExitPlanId,
  type SignalPreset,
  type SignalPresetId,
  type SignalPresets,
  type SignalTimeframe,
  type SignalTrack,
  type SignalTrackStat,
  type SignalView,
} from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import { useNotifications } from "@/hooks/useNotifications";
import { MenuSection } from "@/components/ui/MenuSection";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { InfoTip } from "@/components/ui/InfoTip";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import { OUTCOME, VERDICT, ago, fmtPx, fmtR, marketOfBulk } from "@/components/signals/format";

const ABOUT: Record<SignalPresetId, string> = {
  trend_pullback: "Buys dips in an uptrend: EMA 50 above EMA 200 and RSI back above 40. Mirrored for shorts.",
  momentum_cross: "EMA 9 crossing EMA 21 while ADX shows a real trend.",
  breakout: "A close beyond the last 20 candles' range on 1.5× average volume.",
  mean_reversion: "RSI back from oversold after a flush below the lower Bollinger band. Trades against the move.",
};

const PLAN_ABOUT: Record<SignalExitPlanId, string> = {
  scale_out: "Half off at 1R, stop to break-even, the rest at 2R (mean reversion trails it). Wins more often.",
  target_1_5: "Whole position at 1.5R.",
  target_2: "Whole position at 2R.",
  target_3: "Whole position at 3R. Wins least often, pays most when it does.",
};

type Tab = "signals" | "alerts" | "new";

/** Signals beta: live record, the signal feed, the user's alerts, a new-alert form. */
export function SignalsPanel({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const { privyId } = useNotifications();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("signals");
  const [presets, setPresets] = useState<SignalPresets | null>(null);
  const [alerts, setAlerts] = useState<SignalAlert[] | null>(null);
  const [feed, setFeed] = useState<SignalView[] | null>(null);
  const [track, setTrack] = useState<SignalTrack | null>(null);

  const reload = useCallback(async () => {
    if (!privyId) return;
    const [p, a, f, t] = await Promise.all([
      api.signalPresets(privyId),
      api.signalAlerts(privyId),
      api.signalFeed(privyId),
      api.signalTrack(privyId).catch(() => null),
    ]);
    setPresets(p);
    setAlerts(a.alerts);
    setFeed(f.signals);
    setTrack(t);
  }, [privyId]);

  useEffect(() => {
    void reload().catch(() => toast("Couldn't load signals", { type: "error", description: "Try again in a moment." }));
  }, [reload, toast]);

  const presetOf = useMemo(() => new Map((presets?.presets ?? []).map((p) => [p.id, p])), [presets]);

  if (!privyId) return <div className="py-10 text-center text-sm text-text-muted">Sign in to use signals</div>;
  if (!presets || !alerts || !feed) {
    return (
      <div className="glass-inset rounded-2xl p-4">
        <SkeletonText width="66%" />
        <SkeletonText width="50%" className="mt-3" />
      </div>
    );
  }

  const openSignal = (s: SignalView) => {
    const m = marketOfBulk(s.symbol);
    if (!m) return;
    onNavigate();
    router.push(`/trade/${m}?signal=${s.id}`);
  };

  const toggle = async (a: SignalAlert, active: boolean) => {
    setAlerts((xs) => xs?.map((x) => (x.id === a.id ? { ...x, active } : x)) ?? xs);
    try {
      await api.updateSignalAlert(privyId, a.id, { active });
    } catch (e) {
      setAlerts((xs) => xs?.map((x) => (x.id === a.id ? { ...x, active: !active } : x)) ?? xs);
      toast(e instanceof Error ? e.message : "Couldn't update the alert", { type: "error" });
    }
  };

  const remove = async (a: SignalAlert) => {
    setAlerts((xs) => xs?.filter((x) => x.id !== a.id) ?? xs);
    await api.deleteSignalAlert(privyId, a.id).catch(() => void reload());
  };

  // Live record of the validated presets, pooled.
  const validatedLive = (() => {
    if (!track) return null;
    const rows = presets.presets.flatMap((p) => p.validated.map((tf) => track.global[`${p.id}|${tf}`]).filter(Boolean)) as SignalTrackStat[];
    const n = rows.reduce((a, r) => a + r.signals, 0);
    if (!n) return null;
    const wins = rows.reduce((a, r) => a + r.wins, 0);
    const avgR = rows.reduce((a, r) => a + r.avgR * r.signals, 0) / n;
    return { n, winRate: wins / n, avgR };
  })();

  return (
    <div className="flex flex-col">
      {tab !== "new" && (
        <div className="glass-inset mb-4 flex rounded-full p-1 text-sm">
          {(["signals", "alerts"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 rounded-full py-1.5 transition-colors ${tab === t ? "bg-white/10 font-semibold text-text" : "text-text-muted"}`}
            >
              {t === "signals" ? "Signals" : `Alerts${alerts.length ? ` · ${alerts.filter((a) => a.active).length}` : ""}`}
            </button>
          ))}
        </div>
      )}

      {tab === "signals" && (
        <>
          <div className="glass-inset mb-3 flex items-center gap-4 rounded-2xl px-4 py-3">
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-text-muted">
                Live record · 90d
                <InfoTip>
                  Every signal from the validated strategies, followed to its exit with its exit plan whether or not anyone traded it. Fees included.
                </InfoTip>
              </div>
              {validatedLive ? (
                <div className="tabular mt-0.5 text-sm">
                  <span className="font-semibold">{Math.round(validatedLive.winRate * 100)}% wins</span>
                  <span className={validatedLive.avgR >= 0 ? "text-up" : "text-down"}> · {fmtR(validatedLive.avgR)} avg</span>
                  <span className="text-text-muted"> · {validatedLive.n} signals</span>
                </div>
              ) : (
                <div className="mt-0.5 text-sm text-text-muted">Building up</div>
              )}
            </div>
          </div>

          {feed.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-text-muted">
              <HugeiconsIcon icon={Target02Icon} size={28} />
              <div className="mt-2 text-sm">No signals yet</div>
              {alerts.length === 0 && (
                <button type="button" onClick={() => setTab("new")} className="mt-4 rounded-full bg-up px-5 py-2 text-sm font-semibold text-bg">
                  Create an alert
                </button>
              )}
            </div>
          ) : (
            <div className="glass-inset flex flex-col divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
              {feed.map((s) => {
                const v = VERDICT[s.verdict];
                const done = s.outcome ? OUTCOME[s.outcome] : null;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => openSignal(s)}
                    disabled={!marketOfBulk(s.symbol)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] ${s.expired && !s.outcome ? "opacity-60" : ""}`}
                  >
                    <span className={`w-12 shrink-0 text-xs font-bold ${s.direction === "long" ? "text-up" : "text-down"}`}>
                      {s.direction === "long" ? "LONG" : "SHORT"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {s.symbol.replace(/-USD$/, "")} · {s.presetLabel} {s.timeframe}
                        {!s.validated && <span className="text-[10px] text-text-muted">exp.</span>}
                      </div>
                      <div className="tabular text-xs text-text-muted">
                        {fmtPx(s.price)} · SL {fmtPx(s.stop)}
                        {s.tp1 ? ` · TP1 ${fmtPx(s.tp1)}` : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {done && s.outcomeR !== null ? (
                        <span className={`tabular rounded-md px-1.5 py-0.5 text-[10px] font-bold ${s.outcomeR > 0 ? "bg-up-soft text-up" : s.outcomeR < 0 ? "bg-down-soft text-down" : "bg-white/[0.06] text-text-muted"}`}>
                          {done} {fmtR(s.outcomeR)}
                        </span>
                      ) : (
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${v.className}`}>{s.status === "taken" ? "Taken" : v.label}</span>
                      )}
                      <span className="tabular text-[11px] text-text-muted">{s.outcome ? "closed" : s.expired ? "running" : ago(s.createdAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "alerts" && (
        <>
          {alerts.length > 0 && (
            <MenuSection className="mb-4">
              {alerts.map((a) => {
                const live = track?.alerts[a.id];
                const p = presetOf.get(a.preset);
                const test = p?.stats[a.timeframe]?.[a.exitPlan]?.test;
                return (
                  <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-sm">
                        {a.symbol.replace(/-USD$/, "")} · {p?.label ?? a.preset} {a.timeframe}
                        {!a.validated && <span className="text-[10px] text-text-muted">exp.</span>}
                      </div>
                      <div className="tabular text-xs text-text-muted">
                        {test ? `Backtest ${Math.round(test.winRate * 100)}% ${fmtR(test.avgR)}` : "No backtest"}
                        {live?.signals ? ` · Live ${live.wins}/${live.signals} ${fmtR(live.avgR)}` : ""}
                      </div>
                    </div>
                    <ToggleSwitch on={a.active} onChange={(on) => void toggle(a, on)} />
                    <button type="button" aria-label="Delete alert" onClick={() => void remove(a)} className="text-text-muted hover:text-down">
                      <HugeiconsIcon icon={Delete02Icon} size={16} />
                    </button>
                  </div>
                );
              })}
            </MenuSection>
          )}
          <button
            type="button"
            onClick={() => setTab("new")}
            disabled={alerts.filter((a) => a.active).length >= presets.maxAlerts}
            className="glass-inset flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors hover:bg-white/[0.06] disabled:opacity-40"
          >
            <HugeiconsIcon icon={Add01Icon} size={16} />
            New alert
          </button>
        </>
      )}

      {tab === "new" && (
        <NewAlert
          presets={presets}
          onCancel={() => setTab("alerts")}
          onCreate={async (input) => {
            try {
              await api.createSignalAlert(privyId, input);
              toast("Alert on", { type: "success" });
              await reload();
              setTab("alerts");
            } catch (e) {
              toast(e instanceof Error ? e.message : "Couldn't create the alert", { type: "error" });
            }
          }}
        />
      )}
    </div>
  );
}

function NewAlert({
  presets,
  onCancel,
  onCreate,
}: {
  presets: SignalPresets;
  onCancel: () => void;
  onCreate: (input: {
    symbol: string;
    preset: SignalPresetId;
    timeframe: SignalTimeframe;
    notifyMin: "confirmed" | "caution";
    exitPlan: SignalExitPlanId;
  }) => Promise<void>;
}) {
  // Markets this app lists AND Bulk trades.
  const markets = useMemo(() => presets.markets.filter((m) => marketOfBulk(m)), [presets.markets]);
  const [symbol, setSymbol] = useState(markets.includes(MARKETS.BTC.bulkSymbol) ? MARKETS.BTC.bulkSymbol : (markets[0] ?? ""));
  const [preset, setPreset] = useState<SignalPresetId>("trend_pullback");
  const [tf, setTf] = useState<SignalTimeframe>("4h");
  const [plan, setPlan] = useState<SignalExitPlanId>("scale_out");
  const [caution, setCaution] = useState(false);
  const [busy, setBusy] = useState(false);
  const on = (p: SignalPreset) => p.validated.includes(tf);

  return (
    <div className="flex flex-col">
      <MenuSection title="Market" className="mb-4">
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {markets.map((m) => (
            <Chip key={m} on={m === symbol} onClick={() => setSymbol(m)}>
              {m.replace(/-USD$/, "")}
            </Chip>
          ))}
        </div>
      </MenuSection>

      <MenuSection title="Timeframe" className="mb-4">
        <div className="flex items-center gap-1.5 px-4 py-3">
          {presets.timeframes.map((t) => (
            <Chip key={t} on={t === tf} onClick={() => setTf(t)}>
              {t}
            </Chip>
          ))}
          {tf !== "4h" && (
            <InfoTip variant="info" label="Warning">
              Every strategy lost money on {tf} in the out-of-sample test: fees are large next to its small stops. 4h is the validated timeframe.
            </InfoTip>
          )}
        </div>
      </MenuSection>

      <MenuSection title="Strategy" className="mb-4">
        {[...presets.presets]
          .sort((a, b) => Number(on(b)) - Number(on(a)))
          .map((p) => {
            const test = p.stats[tf]?.[plan]?.test;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPreset(p.id)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors hover:bg-white/[0.04] ${preset === p.id ? "bg-white/[0.06]" : ""}`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${preset === p.id ? "bg-up" : "bg-white/15"}`} />
                <span className="flex flex-1 items-center gap-1.5">
                  {p.label}
                  {on(p) ? (
                    <span className="rounded bg-up-soft px-1 py-px text-[10px] font-semibold text-up">Validated</span>
                  ) : (
                    <span className="rounded bg-white/[0.06] px-1 py-px text-[10px] text-text-muted">Experimental</span>
                  )}
                  <InfoTip>{ABOUT[p.id]}</InfoTip>
                </span>
                {test && (
                  <span className="flex items-center gap-1">
                    <span className={`tabular text-xs ${test.avgR >= 0 ? "text-up" : "text-down"}`}>
                      {Math.round(test.winRate * 100)}% · {fmtR(test.avgR)}
                    </span>
                    <InfoTip label="Backtest">
                      {`Out of sample (the last 40% of ${p.stats[tf]?.days ?? "?"} days, never used to tune it) on ${presets.backtest.markets.join("/")}: ${test.trades} trades, ${Math.round(test.winRate * 100)}% wins, average ${fmtR(test.avgR)}, profit factor ${test.profitFactor}, worst drawdown ${test.maxDrawdownR}R. Fees included. Past results don't predict future ones.`}
                    </InfoTip>
                  </span>
                )}
              </button>
            );
          })}
      </MenuSection>

      <MenuSection title="Exit plan" className="mb-4">
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
          {presets.exitPlans.map((x) => (
            <Chip key={x.id} on={x.id === plan} onClick={() => setPlan(x.id)}>
              {x.label}
            </Chip>
          ))}
          <InfoTip>{PLAN_ABOUT[plan]}</InfoTip>
        </div>
      </MenuSection>

      <MenuSection className="mb-4">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm">
            Include caution
            <InfoTip>Also alert when the fundamentals are mixed. Blocked signals never alert.</InfoTip>
          </span>
          <ToggleSwitch on={caution} onChange={setCaution} />
        </div>
      </MenuSection>

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="glass-inset flex-1 rounded-2xl py-3 text-sm text-text-muted hover:text-text">
          Cancel
        </button>
        <button
          type="button"
          disabled={!symbol || busy}
          onClick={async () => {
            setBusy(true);
            await onCreate({ symbol, preset, timeframe: tf, notifyMin: caution ? "caution" : "confirmed", exitPlan: plan });
            setBusy(false);
          }}
          className="flex-1 rounded-2xl bg-up py-3 text-sm font-bold text-bg disabled:opacity-40"
        >
          {busy ? "Saving…" : "Create alert"}
        </button>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${on ? "bg-up text-bg" : "bg-white/[0.06] text-text-muted hover:text-text"}`}
    >
      {children}
    </button>
  );
}
