"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { HugeiconsIcon } from "@hugeicons/react";
import { GridViewIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import {
  api,
  type GridBotView,
  type GridPreviewInput,
  type GridPreviewResult,
  type GridStatus,
} from "@/lib/api";
import { config } from "@/lib/config";
import { MARKETS } from "@/lib/markets";
import { formatPrice, formatUsd } from "@/lib/format";
import { authorizeAgentWallet, claimFaucet, isAgentAlreadyAuthorizedError } from "@/lib/bulk/onboarding";
import { useAppSelector } from "@/store/hooks";
import { useFeatures } from "@/hooks/useFeatures";
import { useToast } from "@/components/toast/ToastProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { MenuSection } from "@/components/ui/MenuSection";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { useAgentWallet } from "@/hooks/useAgentWallet";

// The Grid bot: one screen to set up (market, amount, auto range, an honest
// preview), one screen while it runs (net result, fees, funding, drawdown,
// exposure), and Stop. All trading happens on the backend engine against the
// bot's own Bulk sub-account; this panel only shows state and records intent.

const POLL_MS = 5000;

const REASON: Record<string, string> = {
  user: "Stopped by you",
  range_below: "Price fell below the range",
  range_above: "Price rose above the range",
  drawdown: "Hit the loss limit",
  admin: "Stopped by Tradash",
  revoked: "Grid access removed",
  start_failed: "Couldn't start",
  error: "Stopped after an error",
};

const STATUS: Record<GridBotView["status"], { label: string; tone: string }> = {
  starting: { label: "Starting…", tone: "text-text-muted" },
  running: { label: "Running", tone: "text-up" },
  stopping: { label: "Stopping…", tone: "text-text-muted" },
  stopped: { label: "Stopped", tone: "text-text-muted" },
  error: { label: "Needs attention", tone: "text-down" },
};

const signed = (v: number | null | undefined) =>
  v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatUsd(Math.abs(v))}`;
const pct = (v: number, digits = 1) => `${(v * 100).toFixed(digits)}%`;
const base = (symbol: string) => symbol.replace(/-USD$/, "");

/**
 * The one wallet signature the bot needs: authorize its server-held key on
 * Bulk, then have the backend see it there. Also how a key the user revoked
 * on Bulk is enabled again (the backend reports it unauthorized, issueKey
 * returns the same key, and authorizing it again works).
 */
async function enableBotKey(privyId: string, agent: ReturnType<typeof useAgentWallet>, step: (s: string) => void) {
  if (!agent.masterAddress) throw new Error("Connect your wallet first.");
  step("Creating the bot key…");
  const key = await api.gridIssueKey(privyId);
  if (key.authorized) return;
  step("Approve in your wallet…");
  try {
    await authorizeAgentWallet(agent.masterAddress, key.pubkey, agent.masterSign);
  } catch (e) {
    if (!isAgentAlreadyAuthorizedError(e)) throw e;
  }
  step("Confirming with Bulk…");
  for (let i = 0; ; i++) {
    try {
      await api.gridConfirmKey(privyId);
      return;
    } catch (e) {
      if (i === 5) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export function GridPanel({ agent }: { agent: ReturnType<typeof useAgentWallet> }) {
  const { user } = usePrivy();
  const privyId = user?.id ?? null;
  const { gridBot } = useFeatures();
  const [status, setStatus] = useState<GridStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!privyId) return;
    try {
      setStatus(await api.gridStatus(privyId));
      setError(null);
    } catch {
      setError("Couldn't load the Grid bot.");
    }
  }, [privyId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!status) {
    return error ? (
      <Notice text={error} action={{ label: "Try again", onClick: load }} />
    ) : (
      <div className="glass-inset h-40 animate-pulse rounded-2xl" />
    );
  }
  if (status.network !== config.bulk.network) {
    return (
      <Notice
        text={`Grid bots run on Bulk ${status.network}, but the app is on ${config.bulk.network}. Switch networks to use them.`}
      />
    );
  }
  if (!status.enabled) return <Notice text="Grid bots aren't available on mainnet yet." />;

  return (
    <div className="flex flex-col gap-4">
      {status.network === "testnet" && (
        <p className="rounded-xl bg-white/[0.04] px-3 py-2 text-center text-[11px] text-text-muted">
          Testnet — test funds only. Fees are estimated at mainnet rates.
        </p>
      )}
      {(status.halted || gridBot?.botsHalted) && (
        <p className="rounded-xl bg-down/10 px-3 py-2 text-center text-xs text-down">
          Grid bots are paused by Tradash right now.
        </p>
      )}
      {status.active ? (
        <RunningView
          bot={status.active}
          privyId={privyId!}
          agent={agent}
          keyAuthorized={!!status.key?.authorized}
          onChanged={load}
        />
      ) : (
        <SetupView status={status} privyId={privyId!} agent={agent} onStarted={load} />
      )}
      {status.recent.length > 0 && <Recent bots={status.recent} />}
    </div>
  );
}

// --- setup ------------------------------------------------------------------------

function SetupView({
  status,
  privyId,
  agent,
  onStarted,
}: {
  status: GridStatus;
  privyId: string;
  agent: ReturnType<typeof useAgentWallet>;
  onStarted: () => Promise<void>;
}) {
  const { toast } = useToast();
  const active = useAppSelector((s) => s.market.active);
  const activeBulk = MARKETS[active]?.bulkSymbol;
  const [symbol, setSymbol] = useState(status.markets.includes(activeBulk) ? activeBulk : status.markets[0]!);
  const balance = status.balance ?? 0;
  const [amount, setAmount] = useState(() => String(Math.floor(Math.min(100, balance, status.maxCapital)) || ""));
  const [custom, setCustom] = useState(false);
  const [lower, setLower] = useState("");
  const [upper, setUpper] = useState("");
  const [levels, setLevels] = useState("20");
  const [preview, setPreview] = useState<GridPreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const seq = useRef(0);

  // Testnet and mainnet are separate Bulk accounts: a wallet funded on mainnet
  // has NO testnet account (Bulk says ACCOUNT_NOT_FOUND) until the testnet
  // faucet creates and funds it. Offer it right here instead of sending the
  // user to find one-tap setup.
  const needsTestFunds = status.network === "testnet" && status.balance !== null && status.balance < 1;
  const getTestFunds = async () => {
    if (!agent.masterAddress || funding) return;
    playSound("tap");
    haptic("tap");
    setFunding(true);
    try {
      await claimFaucet(agent.masterAddress, agent.masterSign);
      toast("Test USDC on its way", { type: "success", description: "Your testnet trading balance updates in a few seconds." });
      await new Promise((r) => setTimeout(r, 2500));
      await onStarted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      toast("Couldn't get test funds", {
        type: "error",
        description: /limit|already|24/i.test(msg) ? "The faucet allows one claim per day." : msg || undefined,
      });
    } finally {
      setFunding(false);
    }
  };

  const capital = Number(amount);
  const input: GridPreviewInput | null = useMemo(() => {
    if (!(capital > 0)) return null;
    if (!custom) return { symbol, capital };
    const lo = Number(lower);
    const hi = Number(upper);
    const n = Math.round(Number(levels));
    if (!(lo > 0 && hi > lo && n >= 2)) return null;
    return { symbol, capital, range: { lower: lo, upper: hi, intervals: n } };
  }, [symbol, capital, custom, lower, upper, levels]);

  // Debounced live preview: every number the user sees comes from the same
  // sizing code the engine uses.
  useEffect(() => {
    if (!input) {
      setPreview(null);
      return;
    }
    const id = ++seq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const p = await api.gridPreview(privyId, input);
        if (id !== seq.current) return;
        setPreview(p);
        setPreviewError(null);
        // Seed the custom fields from the auto range the first time.
        if (!custom && !lower) {
          setLower(String(Math.round(p.params.lower)));
          setUpper(String(Math.round(p.params.upper)));
          setLevels(String(p.params.intervals));
        }
      } catch (e) {
        if (id === seq.current) setPreviewError(e instanceof Error ? e.message : "Couldn't preview this grid.");
      } finally {
        if (id === seq.current) setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, privyId]);

  const p = preview?.preview;
  const worst = p ? Math.max(p.worstLossDown, p.worstLossUp) : 0;
  const canStart = !!input && !!p?.ok && !previewing && !starting && !status.halted;
  const needsKey = !status.key?.authorized;

  const start = async () => {
    if (!input || !canStart) return;
    playSound("tap");
    haptic("tap");
    try {
      if (needsKey) await enableBotKey(privyId, agent, setStarting);
      setStarting("Starting the bot…");
      await api.gridStart(privyId, input);
      toast("Grid bot starting", { type: "success", description: "It places its orders within a few seconds." });
      await onStarted();
    } catch (e) {
      toast("Couldn't start the bot", { type: "error", description: e instanceof Error ? e.message : undefined });
    } finally {
      setStarting(null);
    }
  };

  return (
    <>
      {/* Market */}
      <div className="flex gap-2">
        {status.markets.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              haptic("tap");
              setSymbol(m);
              setLower("");
            }}
            className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-colors ${
              m === symbol ? "bg-up text-black" : "glass-inset text-text-muted hover:text-text"
            }`}
          >
            {base(m)}
          </button>
        ))}
      </div>

      {/* Amount */}
      <div className="glass-inset rounded-2xl p-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-text-muted">Amount (USDC)</span>
          <span className="tabular text-[11px] text-text-muted">
            Trading: {status.balance === null ? "—" : formatUsd(balance)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-text-muted">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular w-full bg-transparent text-2xl font-semibold text-text outline-none"
            placeholder="0"
          />
          {balance > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(Math.floor(Math.min(balance, status.maxCapital) * 100) / 100))}
              className="rounded-lg bg-white/5 px-2 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:text-text"
            >
              MAX
            </button>
          )}
        </div>
      </div>

      {needsTestFunds && (
        <button
          type="button"
          onClick={getTestFunds}
          disabled={funding || !agent.masterAddress}
          className="glass-inset -mt-2 flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left disabled:opacity-45"
        >
          <span className="text-xs text-text-muted">
            Your testnet account is empty.
            <span className="block text-[10px] text-text-muted/70">Mainnet funds don&apos;t carry over to testnet.</span>
          </span>
          <span className="shrink-0 rounded-xl bg-up px-3 py-2 text-xs font-bold text-black">
            {funding ? "Claiming…" : "Get test USDC"}
          </span>
        </button>
      )}

      {/* Range */}
      <div className="glass-inset rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Price range</span>
          <div className="flex gap-1 rounded-lg bg-white/5 p-0.5 text-[11px] font-semibold">
            {(["Auto", "Custom"] as const).map((label) => {
              const on = (label === "Custom") === custom;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setCustom(label === "Custom")}
                  className={`rounded-md px-2 py-1 ${on ? "bg-white/10 text-text" : "text-text-muted"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {custom ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Low" value={lower} onChange={setLower} />
            <Field label="High" value={upper} onChange={setUpper} />
            <Field label="Levels" value={levels} onChange={setLevels} />
          </div>
        ) : (
          <p className="mt-2 text-sm">
            {preview ? (
              <span className="tabular">
                {formatPrice(preview.params.lower)} – {formatPrice(preview.params.upper)}{" "}
                <span className="text-text-muted">· {preview.params.intervals + 1} levels</span>
              </span>
            ) : (
              <span className="text-text-muted">Set from the last two weeks of price moves</span>
            )}
          </p>
        )}
      </div>

      {/* Preview */}
      {previewError && <p className="px-1 text-xs text-down">{previewError}</p>}
      {p && (
        <div className={`glass-inset rounded-2xl p-4 transition-opacity ${previewing ? "opacity-60" : ""}`}>
          <Row label="Each grid order" value={p.plan ? `${p.plan.qty} ${base(symbol)} (~${formatUsd(p.minOrderNotional)})` : "—"} />
          <Row
            label="Profit per completed grid"
            value={p.profitPerCycle > 0 ? `${formatUsd(p.profitPerCycle)} (${pct(p.profitPerCyclePct, 2)})` : "—"}
            hint="After fees, for the tightest step"
          />
          <Row
            label="If price leaves the range"
            value={`−${formatUsd(worst)} (${pct(capital > 0 ? worst / capital : 0, 0)})`}
            tone="text-down"
            hint="The bot closes at this loss — it never adds risk outside the range"
          />
          <Row label="Exposure at the range edge" value={`${p.effectiveLeverage.toFixed(1)}× your amount`} />
          {p.errors.map((e) => (
            <p key={e} className="mt-2 text-xs text-down">{e}</p>
          ))}
          {p.ok && p.warnings.slice(0, 1).map((w) => (
            <p key={w} className="mt-3 text-[11px] leading-relaxed text-text-muted">{w}</p>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={start}
        disabled={!canStart}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-up py-3.5 font-semibold text-black transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {starting ?? (needsKey ? "Enable bot trading & start" : "Start grid bot")}
      </button>
      {needsKey && !starting && (
        <p className="-mt-2 px-1 text-center text-[11px] text-text-muted">
          One-time approval in your wallet lets the bot trade its own sub-account. It can&apos;t withdraw your funds.
        </p>
      )}
    </>
  );
}

// --- running -------------------------------------------------------------------------

function RunningView({
  bot,
  privyId,
  agent,
  keyAuthorized,
  onChanged,
}: {
  bot: GridBotView;
  privyId: string;
  agent: ReturnType<typeof useAgentWallet>;
  keyAuthorized: boolean;
  onChanged: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const m = bot.metrics;
  const s = STATUS[bot.status];
  const net = m.netPnl;
  // The engine can only act with the bot key. If the user revoked it on Bulk
  // the bot sits in error with its orders and range stop still resting —
  // stopping it (and getting the funds back) needs the key enabled again.
  const needsKey = !keyAuthorized && bot.status === "error";

  const stop = async () => {
    setConfirm(false);
    setBusy("Stopping…");
    try {
      if (needsKey) await enableBotKey(privyId, agent, setBusy);
      await api.gridStop(privyId, bot.id);
      toast("Stopping the bot", { type: "info", description: "Closing orders and returning funds." });
      await onChanged();
    } catch (e) {
      toast("Couldn't stop the bot", { type: "error", description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="glass-inset rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <HugeiconsIcon icon={GridViewIcon} size={16} className="text-text-muted" />
            {base(bot.symbol)} grid
          </span>
          <span className={`text-xs font-semibold ${s.tone}`}>{s.label}</span>
        </div>
        <p className={`tabular mt-3 text-3xl font-bold ${net == null ? "" : net >= 0 ? "text-up" : "text-down"}`}>
          {signed(net)}
        </p>
        <p className="tabular text-xs text-text-muted">
          Net result · {m.equity != null ? formatUsd(m.equity) : "—"} of {formatUsd(bot.capital)}
        </p>
        <RangeBar bot={bot} />
      </div>

      {bot.lastError && bot.status !== "running" && (
        <p className="rounded-xl bg-down/10 px-3 py-2 text-xs text-down">{bot.lastError}</p>
      )}

      <div className="glass-inset grid grid-cols-2 gap-x-4 gap-y-3 rounded-2xl p-4">
        <Stat label="Open position" value={m.position ? `${m.position > 0 ? "Long" : "Short"} ${Math.abs(m.position)} ${base(bot.symbol)}` : "Flat"} sub={m.exposure ? `${formatUsd(m.exposure)} exposure` : undefined} />
        <Stat label="Open P&L" value={signed(m.unrealizedPnl)} />
        <Stat label="Fees" value={signed(m.fees)} />
        <Stat label="Funding" value={signed(m.funding)} />
        <Stat label="Max drawdown" value={`−${formatUsd(m.maxDrawdown)}`} sub={pct(m.maxDrawdownPct)} />
        <Stat label="Resting orders" value={m.openOrders != null ? String(m.openOrders) : "—"} />
        <Stat label="Volume traded" value={bot.trades ? formatUsd(bot.trades.volume) : "—"} sub={bot.trades ? `${bot.trades.fills} fills` : undefined} />
        <Stat
          label="Completed grids"
          value={bot.trades ? String(bot.trades.closes) : "—"}
          sub={bot.trades ? `${signed(bot.trades.realizedPnl)} realized` : undefined}
        />
      </div>

      {bot.trades && bot.trades.trades.length > 0 && <Trades bot={bot} />}

      {bot.events.length > 0 && (
        <MenuSection title="Activity">
          <div className="flex flex-col gap-1 px-4 py-3">
            {bot.events.slice(0, 5).map((e, i) => (
              <p key={i} className={`text-[11px] ${e.level === "info" ? "text-text-muted" : e.level === "warn" ? "text-yellow-400" : "text-down"}`}>
                {new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {e.message}
              </p>
            ))}
          </div>
        </MenuSection>
      )}

      {(bot.status === "running" || bot.status === "starting" || bot.status === "error") && (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={!!busy}
          className="w-full rounded-2xl bg-down py-3.5 font-semibold text-white transition-transform active:scale-95 disabled:opacity-45"
        >
          {busy ?? (needsKey ? "Re-enable bot key & stop" : "Stop bot")}
        </button>
      )}
      <ConfirmModal
        open={confirm}
        title="Stop the grid bot?"
        body={
          needsKey
            ? "Your wallet first re-enables the bot's key on Bulk (you revoked it there). Then the bot cancels its orders, closes any open position at market, and returns everything to your trading balance."
            : "Cancels its orders, closes any open position at market, and returns everything to your trading balance."
        }
        confirmLabel="Stop bot"
        destructive
        onConfirm={stop}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}

function RangeBar({ bot }: { bot: GridBotView }) {
  const { lower, upper } = bot.range;
  const mark = bot.mark;
  if (!mark) return null;
  // Pad the axis so the range sits in the middle and the stops are visible.
  const pad = (upper - lower) * 0.15;
  const lo = lower - pad;
  const hi = upper + pad;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  const inside = mark >= lower && mark <= upper;
  return (
    <div className="mt-4">
      <div className="relative h-2 rounded-full bg-white/5">
        <div className="absolute inset-y-0 rounded-full bg-up/25" style={{ left: at(lower), right: `calc(100% - ${at(upper)})` }} />
        <div
          className={`absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full ${inside ? "bg-up" : "bg-down"}`}
          style={{ left: at(mark) }}
        />
      </div>
      <div className="tabular mt-1.5 flex justify-between text-[10px] text-text-muted">
        <span>{formatPrice(lower)}</span>
        <span className={inside ? "text-text" : "text-down"}>{formatPrice(mark)}</span>
        <span>{formatPrice(upper)}</span>
      </div>
    </div>
  );
}

function Trades({ bot }: { bot: GridBotView }) {
  const [all, setAll] = useState(false);
  const rows = bot.trades!.trades;
  const shown = all ? rows : rows.slice(0, 8);
  return (
    <MenuSection title="Trades">
      <div className="flex flex-col px-4 py-2">
        {shown.map((t, i) => (
          <div key={`${t.at}-${i}`} className="flex items-center justify-between gap-3 border-b border-white/[0.04] py-2 last:border-0">
            <span className="min-w-0">
              <span className={`text-xs font-bold ${t.side === "buy" ? "text-up" : "text-down"}`}>
                {t.side === "buy" ? "BUY" : "SELL"}
              </span>
              <span className="tabular ml-2 text-xs">
                {t.size} @ {formatPrice(t.price)}
              </span>
              <span className="tabular block text-[10px] text-text-muted">
                {new Date(t.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                {" · "}
                {formatUsd(t.value)}
                {t.maker ? "" : " · taker"}
                {t.liquidation ? " · liquidation" : ""}
              </span>
            </span>
            {t.realized !== 0 && (
              <span className={`tabular shrink-0 text-xs font-semibold ${t.realized >= 0 ? "text-up" : "text-down"}`}>
                {signed(t.realized)}
              </span>
            )}
          </div>
        ))}
        {rows.length > 8 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="py-2 text-center text-[11px] font-semibold text-text-muted">
            {all ? "Show less" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
    </MenuSection>
  );
}

// --- results -----------------------------------------------------------------------------

function Recent({ bots }: { bots: GridBotView[] }) {
  return (
    <MenuSection title="Past bots">
      {bots.map((b) => (
        <div key={b.id} className="flex items-center justify-between px-4 py-3 text-sm">
          <span>
            {base(b.symbol)} grid
            <span className="block text-[11px] text-text-muted">
              {REASON[b.stopReason ?? ""] ?? "Stopped"} · {b.stoppedAt ? new Date(b.stoppedAt).toLocaleDateString() : ""}
              {b.trades ? ` · ${formatUsd(b.trades.volume)} volume` : ""}
            </span>
          </span>
          <span className={`tabular font-semibold ${b.metrics.netPnl == null ? "" : b.metrics.netPnl >= 0 ? "text-up" : "text-down"}`}>
            {signed(b.metrics.netPnl)}
          </span>
        </div>
      ))}
    </MenuSection>
  );
}

// --- bits ------------------------------------------------------------------------------------

function Row({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs text-text-muted">
        {label}
        {hint && <span className="block text-[10px] text-text-muted/70">{hint}</span>}
      </span>
      <span className={`tabular shrink-0 text-right text-sm font-semibold ${tone ?? ""}`}>{value}</span>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className="tabular text-sm font-semibold">{value}</p>
      {sub && <p className="tabular text-[10px] text-text-muted">{sub}</p>}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="rounded-xl bg-white/5 px-2.5 py-2">
      <span className="block text-[10px] text-text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="tabular w-full bg-transparent text-sm font-semibold text-text outline-none"
      />
    </label>
  );
}

function Notice({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="glass-inset flex flex-col items-center gap-3 rounded-2xl px-4 py-8 text-center">
      <p className="text-sm text-text-muted">{text}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="flex items-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-semibold text-text"
        >
          <HugeiconsIcon icon={Refresh01Icon} size={14} />
          {action.label}
        </button>
      )}
    </div>
  );
}
