"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type SignalBotStartInput, type SignalBotStatus, type SignalExitPlanId, type SignalPresets } from "@/lib/api";
import { config } from "@/lib/config";
import { authorizeAgentWallet, isAgentAlreadyAuthorizedError } from "@/lib/bulk/onboarding";
import type { useAgentWallet } from "@/hooks/useAgentWallet";
import { MenuSection } from "@/components/ui/MenuSection";
import { InfoTip } from "@/components/ui/InfoTip";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import { ago, fmtPx, fmtR, marketOfBulk } from "./format";

/**
 * The signal bot: trades its own confirmed signals with the confirm sheet's
 * sizing and exits, inside hard limits. Paper first (live prices, simulated
 * fills), then Bulk testnet in its own sub-account.
 */

const usd = (x: number) => `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS: Record<string, string> = { starting: "Starting", running: "Running", stopping: "Stopping", stopped: "Stopped", error: "Needs attention" };

export function BotTab({ privyId, presets, agent }: { privyId: string; presets: SignalPresets; agent?: ReturnType<typeof useAgentWallet> }) {
  const { toast } = useToast();
  const [st, setSt] = useState<SignalBotStatus | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const load = useCallback(async () => setSt(await api.signalBot(privyId)), [privyId]);
  useEffect(() => {
    void load().catch(() => toast("Couldn't load the bot", { type: "error" }));
    const t = setInterval(() => void load().catch(() => undefined), 15_000);
    return () => clearInterval(t);
  }, [load, toast]);

  if (!st) {
    return (
      <div className="glass-inset rounded-2xl p-4">
        <SkeletonText width="66%" />
        <SkeletonText width="50%" className="mt-3" />
      </div>
    );
  }
  const bot = st.bot;
  const active = bot && ["starting", "running", "stopping"].includes(bot.status);
  if (!active) return <Setup st={st} presets={presets} privyId={privyId} agent={agent} onStarted={setSt} last={bot} />;

  const open = bot.trades.filter((t) => ["pending", "open", "tp1"].includes(t.state));
  const done = bot.trades.filter((t) => t.state === "closed");
  return (
    <div className="flex flex-col gap-3">
      <div className="glass-inset rounded-2xl p-4">
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded px-1.5 py-0.5 font-semibold ${bot.venue === "paper" ? "bg-white/[0.08] text-text" : "bg-amber-400/15 text-amber-300"}`}>
            {bot.venue === "paper" ? "Paper" : `Bulk ${bot.network}`}
          </span>
          <span className="text-text-muted">{STATUS[bot.status]}</span>
          {bot.config.pausedUntil && new Date(bot.config.pausedUntil).getTime() > Date.now() && (
            <span className="text-amber-300">paused for today</span>
          )}
        </div>
        <div className={`tabular mt-2 text-2xl font-semibold ${bot.netPnl != null && bot.netPnl < 0 ? "text-down" : bot.netPnl ? "text-up" : ""}`}>
          {bot.netPnl != null ? usd(bot.netPnl) : "…"}
        </div>
        <div className="tabular text-xs text-text-muted">
          {bot.equity != null ? usd(bot.equity) : "…"} of {usd(bot.capital)} · {bot.stats.trades} trades
          {bot.stats.trades ? ` · ${Math.round(bot.stats.winRate * 100)}% wins · ${fmtR(bot.stats.avgR)} avg` : ""}
        </div>
      </div>

      <MenuSection title={`Open · ${open.length}/${bot.config.maxOpen}`}>
        {open.length === 0 ? (
          <div className="px-4 py-3 text-sm text-text-muted">Waiting for a confirmed signal</div>
        ) : (
          open.map((t) => {
            const sign = t.direction === "long" ? 1 : -1;
            const pnl = t.mark != null && t.entry != null ? (1 - t.filledFrac) * t.size * sign * (t.mark - t.entry) + t.realizedPnl : null;
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`w-12 text-xs font-bold ${t.direction === "long" ? "text-up" : "text-down"}`}>{t.direction === "long" ? "LONG" : "SHORT"}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    {t.symbol.replace(/-USD$/, "")}
                    {t.state === "tp1" && <span className="ml-1.5 rounded bg-up-soft px-1 text-[10px] text-up">TP1 · BE</span>}
                    {t.state === "pending" && <span className="ml-1.5 text-[10px] text-text-muted">filling…</span>}
                  </div>
                  <div className="tabular text-xs text-text-muted">
                    {t.entry != null ? fmtPx(t.entry) : "…"} · SL {fmtPx(t.stop)}
                    {t.legs[0]?.price ? ` · TP1 ${fmtPx(t.legs[0].price)}` : ""}
                  </div>
                </div>
                <span className={`tabular text-sm ${pnl != null && pnl < 0 ? "text-down" : "text-up"}`}>{pnl != null ? usd(pnl) : "…"}</span>
              </div>
            );
          })
        )}
      </MenuSection>

      {done.length > 0 && (
        <MenuSection title="Closed">
          {done.slice(0, 10).map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex-1">
                {t.symbol.replace(/-USD$/, "")} {t.direction}
                <span className="ml-1.5 text-xs text-text-muted">{t.closeReason}</span>
              </span>
              <span className={`tabular ${t.realizedPnl < 0 ? "text-down" : "text-up"}`}>
                {usd(t.realizedPnl)} {t.r != null ? `· ${fmtR(t.r)}` : ""}
              </span>
            </div>
          ))}
        </MenuSection>
      )}

      {bot.events.length > 0 && (
        <MenuSection title="Log">
          {bot.events.slice(0, 6).map((e, i) => (
            <div key={i} className="flex gap-3 px-4 py-2 text-xs">
              <span className="tabular w-8 shrink-0 text-text-muted">{ago(e.at)}</span>
              <span className={e.level === "error" ? "text-down" : e.level === "warn" ? "text-amber-300" : "text-text-muted"}>{e.message}</span>
            </div>
          ))}
        </MenuSection>
      )}

      {bot.status !== "stopping" && (
        <button type="button" onClick={() => setConfirmStop(true)} className="glass-inset rounded-2xl py-3 text-sm font-semibold text-down hover:bg-white/[0.06]">
          Stop the bot
        </button>
      )}
      <ConfirmModal
        open={confirmStop}
        title="Stop the bot?"
        body={bot.venue === "paper" ? "Open paper trades close at the market price." : "Open positions close at market and the funds return to your trading balance."}
        confirmLabel="Stop"
        destructive
        onCancel={() => setConfirmStop(false)}
        onConfirm={async () => {
          setConfirmStop(false);
          try {
            setSt(await api.stopSignalBot(privyId));
          } catch (e) {
            toast("Couldn't stop the bot", { type: "error", description: e instanceof Error ? e.message : undefined });
          }
        }}
      />
    </div>
  );
}

function Setup({
  st,
  presets,
  privyId,
  agent,
  onStarted,
  last,
}: {
  st: SignalBotStatus;
  presets: SignalPresets;
  privyId: string;
  agent?: ReturnType<typeof useAgentWallet>;
  onStarted: (s: SignalBotStatus) => void;
  last: SignalBotStatus["bot"];
}) {
  const { toast } = useToast();
  const markets = useMemo(() => presets.markets.filter((m) => marketOfBulk(m)), [presets.markets]);
  const [venue, setVenue] = useState<"paper" | "bulk">("paper");
  const [capital, setCapital] = useState("500");
  const [riskPct, setRiskPct] = useState(1);
  const [maxOpen, setMaxOpen] = useState(3);
  const [dailyLossPct, setDaily] = useState(3);
  const [killPct, setKill] = useState(15);
  const [picked, setPicked] = useState<string[]>(markets.filter((m) => ["BTC-USD", "ETH-USD", "SOL-USD"].includes(m)));
  const [strategies, setStrategies] = useState(st.validated.map((v) => `${v.preset}|${v.timeframe}`));
  const [exitPlan, setExitPlan] = useState<SignalExitPlanId>("scale_out");
  const [busy, setBusy] = useState(false);
  const [keyOn, setKeyOn] = useState(st.venues.bulk.keyAuthorized);
  const cap = Number(capital);
  const capErr = !(cap > 0) ? "Enter an amount." : cap > st.maxCapital ? `Up to $${st.maxCapital} in the beta.` : null;

  // Out-of-sample record of what the bot will run, pooled.
  const oos = (() => {
    let n = 0;
    let w = 0;
    let r = 0;
    for (const k of strategies) {
      const [p, tf] = k.split("|");
      const t = presets.presets.find((x) => x.id === p)?.stats[tf as "4h"]?.[exitPlan]?.test;
      if (t) {
        n += t.trades;
        w += t.winRate * t.trades;
        r += t.avgR * t.trades;
      }
    }
    return n ? { n, winRate: w / n, avgR: r / n } : null;
  })();

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const enableKey = async () => {
    if (!agent?.masterAddress) return toast("Connect your wallet first.", { type: "error" });
    const network = st.venues.bulk.network;
    try {
      const key = await api.signalIssueKey(privyId, network);
      if (!key.authorized) {
        try {
          await authorizeAgentWallet(agent.masterAddress, key.pubkey, agent.masterSign);
        } catch (e) {
          if (!isAgentAlreadyAuthorizedError(e)) throw e;
        }
        for (let i = 0; ; i++) {
          try {
            await api.signalConfirmKey(privyId, network);
            break;
          } catch (e) {
            if (i === 5) throw e;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      }
      setKeyOn(true);
    } catch (e) {
      toast("Couldn't turn on bot trading", { type: "error", description: e instanceof Error ? e.message : undefined });
    }
  };

  const start = async () => {
    if (capErr || busy) return;
    setBusy(true);
    try {
      const input: SignalBotStartInput = {
        venue, capital: cap, riskPct, maxOpen, dailyLossPct, killPct, markets: picked, exitPlan,
        strategies: strategies.map((k) => {
          const [preset, timeframe] = k.split("|");
          return { preset: preset as SignalBotStartInput["strategies"][number]["preset"], timeframe: timeframe as "4h" };
        }),
      };
      onStarted(await api.startSignalBot(privyId, input));
      toast(venue === "paper" ? "Paper bot running" : "Bot starting", { type: "success" });
    } catch (e) {
      toast("Couldn't start the bot", { type: "error", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const bulkNetwork = st.venues.bulk.network;
  const appNetwork = config.bulk.network === "mainnet" ? "mainnet" : "testnet";

  return (
    <div className="flex flex-col">
      {last && last.status === "stopped" && (
        <div className="glass-inset mb-3 rounded-2xl px-4 py-3 text-xs text-text-muted">
          Last bot: {last.netPnl != null ? usd(last.netPnl) : "—"} over {last.stats.trades} trades ({last.stopReason ?? "stopped"})
        </div>
      )}

      <MenuSection title="Venue" className="mb-4">
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
          <Chip on={venue === "paper"} onClick={() => setVenue("paper")}>Paper</Chip>
          {st.venues.bulk.available && (
            <Chip on={venue === "bulk"} onClick={() => setVenue("bulk")}>
              Bulk {bulkNetwork}
            </Chip>
          )}
          <InfoTip>
            Paper trades the live market with simulated fills (fees included), no money at risk. Bulk {bulkNetwork} trades for real in its own sub-account, funded from your trading balance and returned when it stops.
          </InfoTip>
        </div>
        {venue === "bulk" && !keyOn && (
          <div className="flex items-center justify-between px-4 pb-3 text-xs">
            <span className="text-text-muted">Needs bot trading on {bulkNetwork}</span>
            <button type="button" onClick={() => void enableKey()} disabled={appNetwork !== bulkNetwork} className="rounded-full bg-white/[0.08] px-3 py-1 font-semibold disabled:opacity-40">
              {appNetwork !== bulkNetwork ? `Switch the app to ${bulkNetwork}` : "Enable"}
            </button>
          </div>
        )}
      </MenuSection>

      <MenuSection title="Money" className="mb-4">
        <Field label="Capital" tip={`Up to $${st.maxCapital} in the beta.`}>
          <input
            value={capital}
            onChange={(e) => setCapital(e.target.value.replace(/[^0-9.]/g, ""))}
            inputMode="decimal"
            className="tabular w-24 rounded-lg bg-white/[0.06] px-2 py-1 text-right text-sm outline-none"
          />
        </Field>
        <Field label="Risk per trade" tip="Lost if a trade's stop is hit. Sets the size; the signal sets the stop.">
          <Steps value={riskPct} set={setRiskPct} min={0.25} max={2} step={0.25} suffix="%" />
        </Field>
        <Field label="Max open" tip="Positions at once. One per market.">
          <Steps value={maxOpen} set={setMaxOpen} min={1} max={5} step={1} />
        </Field>
        <Field label="Daily loss limit" tip="No new trades until 00:00 UTC once today's result reaches this.">
          <Steps value={dailyLossPct} set={setDaily} min={1} max={10} step={1} suffix="%" />
        </Field>
        <Field label="Stop at drawdown" tip="Closes everything and stops the bot.">
          <Steps value={killPct} set={setKill} min={5} max={50} step={5} suffix="%" />
        </Field>
      </MenuSection>

      <MenuSection title="Markets" className="mb-4">
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {markets.map((m) => (
            <Chip key={m} on={picked.includes(m)} onClick={() => setPicked((p) => toggle(p, m))}>
              {m.replace(/-USD$/, "")}
            </Chip>
          ))}
        </div>
      </MenuSection>

      <MenuSection title="Strategies" className="mb-4">
        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
          {st.validated.map((v) => {
            const k = `${v.preset}|${v.timeframe}`;
            return (
              <Chip key={k} on={strategies.includes(k)} onClick={() => setStrategies((s) => toggle(s, k))}>
                {v.label} {v.timeframe}
              </Chip>
            );
          })}
          <InfoTip>Only strategies that stayed positive on history they were never tuned on. Others stay manual alerts.</InfoTip>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          {presets.exitPlans.map((x) => (
            <Chip key={x.id} on={exitPlan === x.id} onClick={() => setExitPlan(x.id)}>
              {x.label}
            </Chip>
          ))}
        </div>
        {oos && (
          <p className="flex items-center gap-1 px-4 pb-3 text-[11px] text-text-muted">
            Out of sample: {Math.round(oos.winRate * 100)}% wins · <span className={oos.avgR >= 0 ? "text-up" : "text-down"}>{fmtR(oos.avgR)}</span> avg over {oos.n} trades
            <InfoTip variant="info">A thin edge, not a promise: at {riskPct}% risk, +{Math.max(0, oos.avgR).toFixed(2)}R per trade is about +{(Math.max(0, oos.avgR) * riskPct).toFixed(2)}% per trade before luck. Start on paper.</InfoTip>
          </p>
        )}
      </MenuSection>

      <button
        type="button"
        disabled={!!capErr || busy || !picked.length || !strategies.length || (venue === "bulk" && !keyOn)}
        onClick={() => void start()}
        className="rounded-2xl bg-up py-3 text-sm font-bold text-bg disabled:opacity-40"
      >
        {busy ? "Starting…" : venue === "paper" ? "Start paper bot" : `Start on Bulk ${bulkNetwork}`}
      </button>
      {capErr && <p className="mt-1 text-center text-xs text-text-muted">{capErr}</p>}
    </div>
  );
}

function Field({ label, tip, children }: { label: string; tip?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="flex items-center gap-1.5 text-sm">
        {label}
        {tip && <InfoTip>{tip}</InfoTip>}
      </span>
      {children}
    </div>
  );
}

function Steps({ value, set, min, max, step, suffix = "" }: { value: number; set: (v: number) => void; min: number; max: number; step: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => set(Math.max(min, +(value - step).toFixed(2)))} className="h-6 w-6 rounded-full bg-white/[0.06] text-text-muted">−</button>
      <span className="tabular w-12 text-center text-sm">
        {value}
        {suffix}
      </span>
      <button type="button" onClick={() => set(Math.min(max, +(value + step).toFixed(2)))} className="h-6 w-6 rounded-full bg-white/[0.06] text-text-muted">+</button>
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
