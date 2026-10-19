"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { api, type SignalExitPlanId, type SignalPreset, type SignalSettings, type SignalView } from "@/lib/api";
import { useAppSelector } from "@/store/hooks";
import { useAllPositions } from "@/hooks/useAllPositions";
import { useToast } from "@/components/toast/ToastProvider";
import { Sheet } from "@/components/ui/Sheet";
import { InfoTip } from "@/components/ui/InfoTip";
import type { useTrade } from "@/hooks/useTrade";
import type { OrderLine } from "@/lib/chart/engine";
import type { useAgentWallet } from "@/hooks/useAgentWallet";
import { config } from "@/lib/config";
import { authorizeAgentWallet, isAgentAlreadyAuthorizedError } from "@/lib/bulk/onboarding";
import { leverageFor, lotSizeForBulkSymbol, minNotionalFor, roundToTick } from "@/lib/markets";
import { fillFeeRate, liveAccountValue } from "@/lib/perp";
import { legSizes, sizeSignalTrade, type SizingLeg } from "@/lib/signals/sizing";
import { VERDICT, fmtPx, fmtR, marketOfBulk } from "./format";

/**
 * The confirm sheet for a signal (`/trade/<COIN>?signal=<id>`): everything a
 * trader checks before clicking — size from their risk %, margin at their
 * leverage, $ at the stop and at each target, R:R after fees, liquidation —
 * then ONE confirm that places the order and its native stop + targets.
 *
 * The stop is the signal's (the market sets it); the risk % sets the SIZE;
 * the exit plan sets where profit is taken.
 *
 * TP/SL is attached from an EFFECT once the position exists: `trade` helpers
 * read positions from the render they came from, so the confirm handler's
 * copy would never see the new position.
 */

const POSITION_WAIT_MS = 15_000;
const RISK_STEPS = [0.5, 1, 2];
const PLANS: Array<{ id: SignalExitPlanId; label: string }> = [
  { id: "scale_out", label: "Scale out" },
  { id: "target_1_5", label: "1.5R" },
  { id: "target_2", label: "2R" },
  { id: "target_3", label: "3R" },
];

/** Legs for a plan from the signal's own entry and stop (structural levels). */
export function signalLegs(s: Pick<SignalView, "direction" | "price" | "stop" | "preset">, plan: SignalExitPlanId): Array<SizingLeg & { r: number }> {
  const sign = s.direction === "long" ? 1 : -1;
  const d = Math.abs(s.price - s.stop);
  const at = (r: number) => s.price + sign * r * d;
  switch (plan) {
    case "scale_out":
      return s.preset === "mean_reversion"
        ? [{ r: 1, frac: 0.5, price: at(1) }, { r: 99, frac: 0.5, price: null }]
        : [{ r: 1, frac: 0.5, price: at(1) }, { r: 2, frac: 0.5, price: at(2) }];
    case "target_1_5":
      return [{ r: 1.5, frac: 1, price: at(1.5) }];
    case "target_2":
      return [{ r: 2, frac: 1, price: at(2) }];
    case "target_3":
      return [{ r: 3, frac: 1, price: at(3) }];
  }
}

const usd = (x: number) => `$${Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Bulk network for the bot key ("devnet" is Bulk's testnet). */
const KEY_NETWORK: "testnet" | "mainnet" = config.bulk.network === "mainnet" ? "mainnet" : "testnet";

/** Issue → authorize on Bulk with one master signature → confirm (the grid's flow, Signals' endpoints). */
async function enableBotKey(privyId: string, agent: ReturnType<typeof useAgentWallet>) {
  if (!agent.masterAddress) throw new Error("Connect your wallet first.");
  const network = KEY_NETWORK;
  const key = await api.signalIssueKey(privyId, network);
  if (key.authorized) return;
  try {
    await authorizeAgentWallet(agent.masterAddress, key.pubkey, agent.masterSign);
  } catch (e) {
    if (!isAgentAlreadyAuthorizedError(e)) throw e;
  }
  for (let i = 0; ; i++) {
    try {
      await api.signalConfirmKey(privyId, network);
      return;
    } catch (e) {
      if (i === 5) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export function SignalSheet({
  privyId,
  signalId,
  trade,
  agent,
  onDone,
  onLines,
}: {
  privyId: string;
  signalId: string;
  trade: ReturnType<typeof useTrade>;
  agent: ReturnType<typeof useAgentWallet>;
  onDone: () => void;
  /** Levels to draw on the chart while the sheet is open (empty to clear). */
  onLines: (lines: OrderLine[]) => void;
}) {
  const { toast } = useToast();
  const [signal, setSignal] = useState<SignalView | null>(null);
  const [preset, setPreset] = useState<SignalPreset | null>(null);
  const [settings, setSettings] = useState<SignalSettings>({ riskPct: 1, exitPlan: "scale_out" });
  const [placing, setPlacing] = useState(false);
  // Bot key on this network = Tradash can move the stop to break-even after TP1.
  const [managed, setManaged] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [pending, setPending] = useState<{ until: number; size: number } | null>(null);
  const applied = useRef(false);
  const loaded = useRef(false);
  // Clock for the countdown (keeps render pure; ticks every 30s).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const symbol = signal ? marketOfBulk(signal.symbol) : null;
  const mark = useAppSelector((s) => (symbol ? (s.price.prices[symbol] ?? null) : null));
  const balance = useAppSelector((s) => s.user.balance);
  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const leverage = useAppSelector((s) => (symbol ? leverageFor(symbol, s.settings.leverageByMarket) : 1));
  const livePosition = useAppSelector((s) => (symbol ? (s.position.bySymbol[symbol] ?? null) : null));
  const { totalPnl } = useAllPositions();

  useEffect(() => {
    let live = true;
    Promise.all([api.signal(privyId, signalId), api.signalSettings(privyId).catch(() => null), api.signalPresets(privyId).catch(() => null)])
      .then(([s, st, ps]) => {
        if (!live) return;
        setSignal(s);
        setPreset(ps?.presets.find((p) => p.id === s.preset) ?? null);
        // The signal's own plan unless the user saved a preference.
        setSettings(st ?? { riskPct: 1, exitPlan: s.exitPlan });
        loaded.current = true;
        api
          .signalKeyStatus(privyId, KEY_NETWORK)
          .then((k) => live && setManaged(k.authorized))
          .catch(() => live && setManaged(false));
      })
      .catch(() => live && onDone());
    return () => {
      live = false;
    };
  }, [privyId, signalId, onDone]);

  // Remember the user's risk % and plan (debounced).
  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(() => void api.saveSignalSettings(privyId, settings).catch(() => undefined), 800);
    return () => clearTimeout(t);
  }, [privyId, settings]);

  const legs = useMemo(() => (signal ? signalLegs(signal, settings.exitPlan) : []), [signal, settings.exitPlan]);
  const live = trade.mode === "live";
  const equity = live ? (balance?.equity != null ? liveAccountValue(balance.equity, totalPnl) : 0) : demoBalance;
  const available = live ? (balance?.available ?? 0) : demoBalance;

  const sizing = useMemo(() => {
    if (!signal || !symbol || mark == null) return null;
    return sizeSignalTrade({
      direction: signal.direction,
      entry: mark,
      stop: signal.stop,
      legs,
      equity,
      availableMargin: available,
      riskPct: settings.riskPct,
      leverage,
      lotSize: lotSizeForBulkSymbol(signal.symbol),
      minNotional: minNotionalFor(symbol),
      feeRate: fillFeeRate(),
    });
  }, [signal, symbol, mark, legs, equity, available, settings.riskPct, leverage]);

  // Chart levels while the sheet is up.
  useEffect(() => {
    if (!signal) return;
    const lines: OrderLine[] = [
      { price: signal.stop, label: "SL", draft: true },
      ...legs.filter((l) => l.price !== null).map((l, i) => ({ price: l.price!, direction: signal.direction, label: legs.length > 1 ? `TP${i + 1}` : "TP", draft: true })),
    ];
    onLines(lines);
    return () => onLines([]);
  }, [signal, legs, onLines]);

  // Attach the stop and targets once the live position shows up.
  useEffect(() => {
    if (!pending || !signal || !symbol || applied.current) return;
    const finish = () => {
      applied.current = true;
      void api.signalTaken(privyId, signal.id).catch(() => undefined);
      setPending(null);
      onDone();
    };
    if (livePosition) {
      applied.current = true;
      const size = livePosition.size;
      const fixed = legs.filter((l) => l.price !== null);
      const sizes = legSizes(size, legs.map((l) => l.frac), lotSizeForBulkSymbol(signal.symbol));
      void trade
        .setScaleOut({
          symbol,
          direction: signal.direction,
          stopLoss: roundToTick(symbol, signal.stop),
          stopSize: size,
          legs: fixed.map((l) => ({ price: roundToTick(symbol, l.price!), size: sizes[legs.indexOf(l)]! })),
        })
        .then(async (ok) => {
          // Hand the exit to Tradash only once Bulk shows the stop + targets resting.
          if (!ok || !managed || legs.length < 2) return;
          await api
            .registerManagedTrade(privyId, signal.id, {
              network: KEY_NETWORK,
              size,
              entry: livePosition.entryPrice,
              exitPlan: settings.exitPlan,
              legs: legs.map((l) => ({ r: l.r, frac: l.frac, price: l.price })),
            })
            .catch((e) => toast("Break-even move not set", { type: "info", description: e instanceof Error ? e.message : undefined }));
        })
        .finally(finish);
      return;
    }
    const t = setTimeout(() => {
      // Also reached when the order itself was refused (that path toasted why).
      toast("Stop and targets not attached", { type: "info", description: "If the trade opened, set TP/SL from the position." });
      finish();
    }, Math.max(0, pending.until - Date.now()));
    return () => clearTimeout(t);
  }, [pending, livePosition, signal, symbol, legs, trade, privyId, onDone, toast, managed, settings.exitPlan]);

  if (!signal) return null;
  const long = signal.direction === "long";
  const v = VERDICT[signal.verdict];
  const blocked = signal.verdict === "veto" || signal.verdict === "rejected";
  const minsLeft = Math.max(0, Math.round((new Date(signal.expiresAt).getTime() - now) / 60_000));
  const drift = mark != null ? ((long ? 1 : -1) * (mark - signal.price)) / Math.abs(signal.price - signal.stop) : null;
  const trailed = legs.some((l) => l.price === null);

  const confirm = async () => {
    if (!sizing?.ok || !symbol || placing || pending) return;
    if (trade.hasPosition) {
      toast(`You already have a ${symbol} position`, { type: "info" });
      return;
    }
    setPlacing(true);
    try {
      await trade.openSized(signal.direction, sizing.size);
      if (live) {
        setPending({ until: Date.now() + POSITION_WAIT_MS, size: sizing.size });
        return;
      }
      toast("Demo trade opened", { type: "info", description: "Stops and targets are live-trading only." });
      void api.signalTaken(privyId, signal.id).catch(() => undefined);
      onDone();
    } finally {
      setPlacing(false);
    }
  };

  const reason =
    !symbol ? "This market isn't in the app." :
    signal.expired ? "This signal has expired." :
    blocked ? (signal.vetoReason ? `Blocked: ${signal.vetoReason}` : "The fundamentals reject this trade.") :
    mark == null ? "Waiting for price…" :
    sizing?.error ?? null;

  return (
    <Sheet open onClose={onDone} title={`${signal.symbol.replace(/-USD$/, "")} ${long ? "Long" : "Short"}`}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-text-muted">
            {signal.presetLabel} {signal.timeframe}
          </span>
          {signal.validated ? (
            <span className="rounded bg-up-soft px-1 py-px text-[10px] font-semibold text-up">Validated</span>
          ) : (
            <span className="rounded bg-white/[0.06] px-1 py-px text-[10px] text-text-muted">Experimental</span>
          )}
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${v.className}`}>{v.label}</span>
          <span className="ml-auto text-text-muted">{signal.expired ? "expired" : `${minsLeft}m left`}</span>
        </div>

        <div className="tabular grid grid-cols-4 gap-1.5 text-center text-xs">
          <Level label="Now" value={mark != null ? fmtPx(mark) : "…"} sub={drift != null ? `${drift >= 0 ? "+" : "−"}${Math.abs(drift).toFixed(2)}R` : undefined} />
          <Level label="SL" value={fmtPx(signal.stop)} tone="down" />
          {legs.map((l, i) => (
            <Level key={i} label={legs.length > 1 ? `TP${i + 1}` : "TP"} value={l.price !== null ? fmtPx(l.price) : "Trail"} tone="up" sub={`${Math.round(l.frac * 100)}%`} />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {signal.factors
            .filter((f) => f.weight > 0 || f.key === "macro")
            .map((f) => (
              <span
                key={f.key}
                title={f.detail}
                className={`rounded-full px-2 py-0.5 text-[11px] ${f.score > 0.15 ? "bg-up-soft text-up" : f.score < -0.15 ? "bg-down-soft text-down" : "bg-white/[0.06] text-text-muted"}`}
              >
                {f.label}
              </span>
            ))}
          <InfoTip label="Why">
            {signal.reason}. Green supports the trade, red works against it; hover a chip for the number.
          </InfoTip>
        </div>

        <div className="glass-inset rounded-2xl p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm">
              Risk
              <InfoTip>How much of your trading balance you lose if the stop is hit. It sets the size; the stop is the signal&apos;s.</InfoTip>
            </span>
            <div className="flex items-center gap-1">
              {RISK_STEPS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, riskPct: r }))}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${settings.riskPct === r ? "bg-up text-bg" : "bg-white/[0.06] text-text-muted"}`}
                >
                  {r}%
                </button>
              ))}
              <Step icon={MinusSignIcon} onClick={() => setSettings((s) => ({ ...s, riskPct: Math.max(0.25, +(s.riskPct - 0.25).toFixed(2)) }))} />
              <span className="tabular w-10 text-center text-xs">{settings.riskPct}%</span>
              <Step icon={PlusSignIcon} onClick={() => setSettings((s) => ({ ...s, riskPct: Math.min(3, +(s.riskPct + 0.25).toFixed(2)) }))} />
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-sm">Exit plan</span>
            <div className="flex gap-1">
              {PLANS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, exitPlan: p.id }))}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${settings.exitPlan === p.id ? "bg-up text-bg" : "bg-white/[0.06] text-text-muted"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {sizing && sizing.size > 0 && (
          <div className="tabular grid grid-cols-2 gap-x-4 gap-y-1.5 px-1 text-xs">
            <Row label="Size" value={`${+sizing.size.toFixed(6)} ${signal.symbol.replace(/-USD$/, "")} · ${usd(sizing.notional)}`} />
            <Row label={`Margin · ${leverage}×`} value={usd(sizing.margin)} />
            <Row label="At stop" value={`−${usd(sizing.riskUsd)}`} tone="down" />
            <Row label={trailed ? "At TP1 (+ trail)" : "At targets"} value={`+${usd(sizing.rewardUsd)}`} tone="up" />
            <Row label="R:R after fees" value={`${sizing.rr.toFixed(2)}`} />
            <Row label="Fees" value={usd(sizing.feesUsd)} />
            <Row label="Liquidation ≈" value={sizing.liquidation ? fmtPx(sizing.liquidation) : "—"} />
            <Row label="Balance" value={usd(equity)} />
          </div>
        )}

        {sizing?.notes.map((n) => (
          <p key={n} className="px-1 text-xs text-amber-300">
            {n}
          </p>
        ))}
        {live && settings.exitPlan === "scale_out" && (
          <div className="flex items-center gap-1.5 px-1 text-xs">
            <span className={managed ? "text-up" : "text-text-muted"}>
              {managed ? "Stop moves to break-even after TP1" : "Stop stays put after TP1"}
            </span>
            <InfoTip variant="info" label="Break-even">
              {trailed
                ? "Bulk can't move a stop or trail on its own. With bot trading on, Tradash moves the stop to break-even and trails the rest after TP1 (one approval in your wallet, revocable on Bulk)."
                : "Bulk can't move a stop on its own. With bot trading on, Tradash moves it to break-even after TP1 (one approval in your wallet, revocable on Bulk)."}
            </InfoTip>
            {managed === false && (
              <button
                type="button"
                disabled={enabling}
                onClick={async () => {
                  setEnabling(true);
                  try {
                    await enableBotKey(privyId, agent);
                    setManaged(true);
                    toast("Bot trading on", { type: "success" });
                  } catch (e) {
                    toast("Couldn't turn on bot trading", { type: "error", description: e instanceof Error ? e.message : undefined });
                  } finally {
                    setEnabling(false);
                  }
                }}
                className="ml-auto rounded-full bg-white/[0.08] px-2.5 py-0.5 font-semibold text-text hover:bg-white/[0.12] disabled:opacity-50"
              >
                {enabling ? "Approve in wallet…" : "Enable"}
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          disabled={!!reason || !sizing?.ok || placing || pending !== null}
          onClick={() => void confirm()}
          className={`w-full rounded-xl py-3 text-sm font-bold text-bg transition-opacity disabled:opacity-40 ${long ? "bg-up" : "bg-down"}`}
        >
          {placing ? "Placing…" : pending ? "Setting stop and targets…" : sizing?.ok ? `Confirm ${long ? "long" : "short"} · risk ${usd(sizing.riskUsd)}` : "Can't place"}
        </button>
        {reason && <p className="-mt-1 text-center text-xs text-text-muted">{reason}</p>}
        {(() => {
          const test = preset?.stats[signal.timeframe]?.[settings.exitPlan]?.test;
          return test ? (
            <p className="flex items-center justify-center gap-1 text-center text-[11px] text-text-muted">
              This setup out of sample: {Math.round(test.winRate * 100)}% wins ·{" "}
              <span className={test.avgR >= 0 ? "text-up" : "text-down"}>{fmtR(test.avgR)}</span> avg · {test.trades} trades
              <InfoTip>Tested on history it was never tuned on, fees included. A small positive average is a real but thin edge; past results don&apos;t predict future ones.</InfoTip>
            </p>
          ) : null;
        })()}
      </div>
    </Sheet>
  );
}

function Level({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  return (
    <div className="glass-inset rounded-xl py-2">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className={`mt-0.5 font-semibold ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-muted">{label}</span>
      <span className={tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}>{value}</span>
    </div>
  );
}

function Step({ icon, onClick }: { icon: typeof PlusSignIcon; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] text-text-muted hover:text-text">
      <HugeiconsIcon icon={icon} size={12} />
    </button>
  );
}
