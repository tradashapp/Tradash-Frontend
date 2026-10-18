"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Delete02Icon, Target02Icon } from "@hugeicons/core-free-icons";
import {
  api,
  type SignalAlert,
  type SignalPreset,
  type SignalPresetId,
  type SignalPresets,
  type SignalTimeframe,
  type SignalView,
} from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import { useNotifications } from "@/hooks/useNotifications";
import { MenuSection } from "@/components/ui/MenuSection";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { InfoTip } from "@/components/ui/InfoTip";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import { VERDICT, ago, fmtPx, fmtR, marketOfBulk } from "@/components/signals/format";

const ABOUT: Record<SignalPresetId, string> = {
  trend_pullback: "Buys dips in an uptrend: EMA 50 above EMA 200 and RSI back above 40. Mirrored for shorts.",
  momentum_cross: "EMA 9 crossing EMA 21 while ADX shows a real trend.",
  breakout: "A close beyond the last 20 candles' range on 1.5× average volume.",
  mean_reversion: "RSI back from oversold after a flush below the lower Bollinger band. Trades against the move.",
};

type Tab = "signals" | "alerts" | "new";

/** Signals beta: the signal feed, the user's alerts, and a new-alert form. */
export function SignalsPanel({ onNavigate }: { onNavigate: () => void }) {
  const router = useRouter();
  const { privyId } = useNotifications();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("signals");
  const [presets, setPresets] = useState<SignalPresets | null>(null);
  const [alerts, setAlerts] = useState<SignalAlert[] | null>(null);
  const [feed, setFeed] = useState<SignalView[] | null>(null);

  const reload = useCallback(async () => {
    if (!privyId) return;
    const [p, a, f] = await Promise.all([api.signalPresets(privyId), api.signalAlerts(privyId), api.signalFeed(privyId)]);
    setPresets(p);
    setAlerts(a.alerts);
    setFeed(f.signals);
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

      {tab === "signals" &&
        (feed.length === 0 ? (
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
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSignal(s)}
                  disabled={!marketOfBulk(s.symbol)}
                  className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] ${s.expired ? "opacity-50" : ""}`}
                >
                  <span className={`w-12 shrink-0 text-xs font-bold ${s.direction === "long" ? "text-up" : "text-down"}`}>
                    {s.direction === "long" ? "LONG" : "SHORT"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {s.symbol.replace(/-USD$/, "")} · {s.presetLabel} {s.timeframe}
                    </div>
                    <div className="tabular text-xs text-text-muted">
                      {fmtPx(s.price)} · SL {fmtPx(s.stop)} · TP {fmtPx(s.target)}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${v.className}`}>{s.status === "taken" ? "Taken" : v.label}</span>
                    <span className="tabular text-[11px] text-text-muted">{s.expired ? "expired" : ago(s.createdAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        ))}

      {tab === "alerts" && (
        <>
          {alerts.length > 0 && (
            <MenuSection className="mb-4">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {a.symbol.replace(/-USD$/, "")} · {presetOf.get(a.preset)?.label ?? a.preset} {a.timeframe}
                    </div>
                    <div className="text-xs text-text-muted">{a.notifyMin === "caution" ? "Confirmed + caution" : "Confirmed only"}</div>
                  </div>
                  <ToggleSwitch on={a.active} onChange={(on) => void toggle(a, on)} />
                  <button type="button" aria-label="Delete alert" onClick={() => void remove(a)} className="text-text-muted hover:text-down">
                    <HugeiconsIcon icon={Delete02Icon} size={16} />
                  </button>
                </div>
              ))}
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

function statLine(p: SignalPreset, tf: SignalTimeframe) {
  const s = p.stats[tf];
  if (!s) return null;
  return { s, text: `${fmtR(s.avgR)} avg · ${s.trades} trades` };
}

function NewAlert({
  presets,
  onCancel,
  onCreate,
}: {
  presets: SignalPresets;
  onCancel: () => void;
  onCreate: (input: { symbol: string; preset: SignalPresetId; timeframe: SignalTimeframe; notifyMin: "confirmed" | "caution" }) => Promise<void>;
}) {
  // Markets this app lists AND Bulk trades.
  const markets = useMemo(() => presets.markets.filter((m) => marketOfBulk(m)), [presets.markets]);
  const [symbol, setSymbol] = useState(markets.includes(MARKETS.BTC.bulkSymbol) ? MARKETS.BTC.bulkSymbol : (markets[0] ?? ""));
  const [preset, setPreset] = useState<SignalPresetId>("trend_pullback");
  const [tf, setTf] = useState<SignalTimeframe>("4h");
  const [caution, setCaution] = useState(false);
  const [busy, setBusy] = useState(false);

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
        <div className="flex gap-1.5 px-4 py-3">
          {presets.timeframes.map((t) => (
            <Chip key={t} on={t === tf} onClick={() => setTf(t)}>
              {t}
            </Chip>
          ))}
        </div>
      </MenuSection>

      <MenuSection title="Strategy" className="mb-4">
        {presets.presets.map((p) => {
          const st = statLine(p, tf);
          const losing = st && st.s.avgR < 0;
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
                <InfoTip>{ABOUT[p.id]}</InfoTip>
                {(losing || p.counterTrend) && (
                  <InfoTip variant="info" label="Warning">
                    {[
                      losing ? `Lost money in the ${tf} backtest after fees.` : null,
                      p.counterTrend ? "Trades against the current move." : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  </InfoTip>
                )}
              </span>
              {st && (
                <span className="flex items-center gap-1">
                  <span className={`tabular text-xs ${st.s.avgR >= 0 ? "text-up" : "text-down"}`}>{st.text}</span>
                  <InfoTip label="Backtest">
                    {`${tf} backtest over ${st.s.days} days on ${presets.backtest.markets.map((m) => m.replace(/-USD$/, "")).join("/")}: ${st.s.trades} trades, ${Math.round(st.s.winRate * 100)}% wins, average ${fmtR(st.s.avgR)}, worst drawdown ${st.s.maxDrawdownR}R. Fees included. 1R = the stop distance. Past results don't predict future ones.`}
                  </InfoTip>
                </span>
              )}
            </button>
          );
        })}
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
            await onCreate({ symbol, preset, timeframe: tf, notifyMin: caution ? "caution" : "confirmed" });
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
