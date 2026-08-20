"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { useFundWallet } from "@privy-io/react-auth/solana";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Wallet01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  Logout01Icon,
  Settings02Icon,
  Clock01Icon,
  ArrowRight01Icon,
  ArrowLeft01Icon,
  ArrowDataTransferVerticalIcon,
  ArrowDataTransferHorizontalIcon,
  HelpCircleIcon,
  Download04Icon,
  Upload04Icon,
  Plant02Icon,
  ShieldKeyIcon,
  CodeIcon,
} from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetDemo } from "@/store/slices/tradingModeSlice";
import { formatUsd } from "@/lib/format";
import { MenuSection } from "@/components/ui/MenuSection";
import { SettingsPanel } from "./panels/SettingsPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import type { ShareSubject } from "@/components/share/ShareCardModal";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { useCollateral } from "@/hooks/useCollateral";
import { useAllPositions } from "@/hooks/useAllPositions";
import { ProfileHeader } from "./ProfileHeader";

type View = "menu" | "settings" | "history" | "transfer";

interface Props {
  open: boolean;
  onClose: () => void;
  agent: ReturnType<typeof useAgentWallet>;
  onOpenTutorial: () => void;
  onOpenInstall: () => void;
  onShare: (subject: ShareSubject) => void;
}

// The menu view has no title — it leads with the profile header instead.
const TITLES: Record<View, string> = {
  menu: "",
  settings: "Settings",
  history: "Trade history",
  transfer: "Transfer margin",
};

// Central account hub. A single sheet with sub-views (menu → settings/history)
// navigated by a back icon in the top-left, rather than separate sheets.
export function AccountSheet({
  open,
  onClose,
  agent,
  onOpenTutorial,
  onOpenInstall,
  onShare,
}: Props) {
  const dispatch = useAppDispatch();
  const { login, logout, authenticated } = usePrivy();
  const [view, setView] = useState<View>("menu");
  // Which way the transfer panel starts out: "in" = wallet→trading (deposit),
  // "out" = trading→wallet (withdraw). Set by the action button that opened it.
  const [transferDir, setTransferDir] = useState<"in" | "out">("in");

  const mode = useAppSelector((s) => s.tradingMode.mode);
  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const liveEquity = useAppSelector((s) => s.user.balance?.equity);
  const bulkUnrealized = useAppSelector((s) => s.user.balance?.unrealizedPnl);
  const agentAuthorized = useAppSelector((s) => s.trading.agentAuthorized);
  const builderApproved = useAppSelector((s) => s.trading.builderApproved);
  const collateral = useCollateral(agent.masterAddress, agent.masterSign);
  // Unrealized PnL across every open position, re-derived each price tick — this
  // is what makes the trading (and so the total) balance move in real time.
  const { totalPnl } = useAllPositions();
  const trades = useAppSelector((s) => s.history.trades);

  // PnL realized since local midnight, for the current account only. `add` rows
  // record an increase in size and realize nothing, so they're excluded.
  const realizedToday = useMemo(() => {
    const midnight = new Date().setHours(0, 0, 0, 0);
    return trades.reduce(
      (sum, t) =>
        t.mode === mode && t.kind !== "add" && t.closedAt >= midnight
          ? sum + t.pnl
          : sum,
      0
    );
  }, [trades, mode]);

  // Refresh the wallet balance each time the sheet opens (it may have changed
  // since the last poll — e.g. right after a deposit or an external transfer).
  useEffect(() => {
    if (open) collateral.refreshWallet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset to the menu whenever the sheet is (re)opened.
  useEffect(() => {
    if (open) setView("menu");
  }, [open]);

  const go = (v: View) => {
    playSound("tap");
    haptic("tap");
    setView(v);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="bg-[#08090C] fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-[50px] p-4 pb-8"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-up" />

            {/* Header: sub-views get a back button + title. The menu view has
                no title bar — its profile header (avatar + handle) leads. */}
            {view !== "menu" && (
              <div className="relative mb-3 flex h-6 shrink-0 items-center justify-center">
                <button
                  type="button"
                  onClick={() => go("menu")}
                  aria-label="Back"
                  className="absolute left-0 flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-text active:scale-90"
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
                </button>
                <span className="text-sm font-medium text-text-muted">
                  {TITLES[view]}
                </span>
              </div>
            )}

            {/* Animated sub-views */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={view}
                  initial={{ opacity: 0, x: view === "menu" ? -20 : 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: view === "menu" ? 20 : -20 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  {view === "menu" && (
                    <Menu
                      mode={mode}
                      demoBalance={demoBalance}
                      liveEquity={liveEquity}
                      bulkUnrealized={bulkUnrealized}
                      totalPnl={totalPnl}
                      realizedToday={realizedToday}
                      collateral={collateral}
                      authenticated={authenticated}
                      agent={agent}
                      agentAuthorized={agentAuthorized}
                      builderApproved={builderApproved}
                      onResetDemo={() => dispatch(resetDemo())}
                      onLogin={login}
                      onLogout={logout}
                      onSettings={() => go("settings")}
                      onHistory={() => go("history")}
                      onTransfer={(dir) => {
                        setTransferDir(dir);
                        go("transfer");
                      }}
                      onTutorial={onOpenTutorial}
                      onInstall={onOpenInstall}
                    />
                  )}
                  {view === "settings" && <SettingsPanel />}
                  {view === "history" && (
                    <HistoryPanel
                      onShare={(trade) => onShare({ kind: "trade", trade })}
                    />
                  )}
                  {view === "transfer" && (
                    <TransferPanel
                      collateral={collateral}
                      masterAddress={agent.masterAddress}
                      initialDir={transferDir}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Menu({
  mode,
  demoBalance,
  liveEquity,
  bulkUnrealized,
  totalPnl,
  realizedToday,
  collateral,
  authenticated,
  agent,
  agentAuthorized,
  builderApproved,
  onResetDemo,
  onLogin,
  onLogout,
  onSettings,
  onHistory,
  onTransfer,
  onTutorial,
  onInstall,
}: {
  mode: "demo" | "live";
  demoBalance: number;
  liveEquity: number | undefined;
  /** Bulk's own unrealized PnL, already inside `liveEquity`. */
  bulkUnrealized: number | undefined;
  /** Our live (MagicBlock-interpolated) unrealized PnL across all positions. */
  totalPnl: number;
  /** PnL realized since local midnight, from the trade log. */
  realizedToday: number;
  collateral: ReturnType<typeof useCollateral>;
  authenticated: boolean;
  agent: ReturnType<typeof useAgentWallet>;
  agentAuthorized: boolean;
  builderApproved: boolean;
  onResetDemo: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onTransfer: (dir: "in" | "out") => void;
  onTutorial: () => void;
  onInstall: () => void;
}) {
  const { fundWallet } = useFundWallet();
  // Privy on-ramp: top up the user's OWN Solana wallet with USDC from outside.
  const onFundWallet = () => {
    if (!agent.masterAddress) return;
    void fundWallet(agent.masterAddress);
  };

  // Live trading balance = realized collateral + our MagicBlock-derived
  // unrealized PnL. Bulk already bakes ITS OWN unrealized figure into `equity`,
  // so we strip that out before adding ours back — otherwise open positions
  // would be counted twice.
  const realizedBase =
    liveEquity != null ? liveEquity - (bulkUnrealized ?? 0) : null;
  const tradingBalance =
    mode === "demo"
      ? demoBalance
      : realizedBase != null
        ? realizedBase + totalPnl
        : null;

  // Total = funding wallet + trading. In demo there's no wallet, so it's just
  // the simulated balance.
  const fundingBalance = mode === "demo" ? null : collateral.walletUsdc;
  const totalBalance =
    mode === "demo"
      ? demoBalance
      : tradingBalance != null || fundingBalance != null
        ? (tradingBalance ?? 0) + (fundingBalance ?? 0)
        : null;

  // Today's P&L = everything realized since local midnight + what's currently
  // floating on open positions. The percentage is against the day's opening
  // balance (today's balance minus today's P&L).
  const todayPnl = realizedToday + totalPnl;
  const dayOpen = totalBalance != null ? totalBalance - todayPnl : null;
  const todayPct =
    dayOpen != null && dayOpen > 0 ? (todayPnl / dayOpen) * 100 : null;
  const todayUp = todayPnl >= 0;

  return (
    <div className="flex flex-col">
      {/* Avatar + handle / login */}
      <ProfileHeader onLogin={onLogin} />

      {/* Balance card: total on top, today's P&L beneath it, then the funding /
          trading split that adds up to the total. */}
      <div className="glass-inset mb-3 rounded-2xl p-4">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Total balance</span>
          {mode === "demo" && (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-text-muted">
              DEMO
            </span>
          )}
        </div>
        <div className="tabular text-3xl font-semibold">
          {totalBalance != null ? formatUsd(totalBalance) : "—"}
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-xs">
          <span className="text-text-muted">Today&rsquo;s P&amp;L</span>
          <span
            className={`tabular font-semibold ${todayUp ? "text-up" : "text-down"}`}
          >
            {todayUp ? "+" : "−"}
            {formatUsd(Math.abs(todayPnl))}
            {todayPct != null && (
              <span className="font-medium">
                {" "}
                ({todayUp ? "+" : "−"}
                {Math.abs(todayPct).toFixed(2)}%)
              </span>
            )}
          </span>
        </div>

        {/* The two balances that make up the total. */}
        <div className="mt-3 flex gap-2">
          <BalanceCell label="Funding" value={fundingBalance} />
          <BalanceCell label="Trading" value={tradingBalance} />
        </div>


        {/* Money actions. Deposit leads in brand green; the rest are glass. */}
        <div className="mt-5 grid grid-cols-4 gap-2">
          <ActionButton
            icon={Download04Icon}
            label="Deposit"
            // primary
            onClick={onFundWallet}
          />
          <ActionButton
            icon={Upload04Icon}
            label="Withdraw"
            onClick={() => onTransfer("out")}
          />
          <ActionButton
            icon={ArrowDataTransferHorizontalIcon}
            label="Transfer"
            onClick={() => onTransfer("in")}
          />
          <ActionButton
            icon={Plant02Icon}
            label="Earn"
            disabled
            onClick={() => { }}
          />
        </div>
      </div>

      {/* Trading — what you reach for mid-session. */}
      <MenuSection title="Trading" className="mb-4">
        <NavRow icon={Clock01Icon} label="Trade history" onClick={onHistory} />
        <NavRow icon={Settings02Icon} label="Settings" onClick={onSettings} />
      </MenuSection>

      {/* Advanced — the Bulk permission plumbing. Read-only status in demo (no
          wallet is connected, so neither step applies); actionable when live. */}
      {mode === "live" && authenticated && (
        <MenuSection title="Advanced" className="mb-4">
          <NavRow
            icon={ShieldKeyIcon}
            label="Agent authorization"
            detail={agentAuthorized ? "Authorized" : "Not set up"}
            status={agentAuthorized ? "done" : "pending"}
            onClick={agentAuthorized || agent.onboarding ? undefined : agent.onboard}
            disabled={agentAuthorized || agent.onboarding}
          />
          <NavRow
            icon={CodeIcon}
            label="Builder code"
            detail={builderApproved ? "Approved" : "Not approved"}
            status={builderApproved ? "done" : "pending"}
            onClick={
              builderApproved || agent.onboarding
                ? undefined
                : agent.approveBuilder
            }
            disabled={builderApproved || agent.onboarding}
          />
        </MenuSection>
      )}

      {/* App — everything that isn't trading. */}
      <MenuSection title="App" className="mb-4">
        <NavRow icon={HelpCircleIcon} label="How it works" onClick={onTutorial} />
        <NavRow icon={Download04Icon} label="Install app" onClick={onInstall} />
      </MenuSection>

      {/* Mode-specific actions */}
      {mode === "demo" ? (
        <button
          type="button"
          onClick={onResetDemo}
          className="glass-inset w-full rounded-2xl py-3 text-sm font-medium text-text-muted transition-colors hover:text-text"
        >
          Reset demo balance
        </button>
      ) : !authenticated ? null : (
        <div className="flex flex-col gap-2">
          {/* Setup is only complete when BOTH steps are done. Gating this on
              `agent.isReady` alone hid the button whenever the agent wallet was
              authorized but the builder code wasn't — leaving every order to be
              rejected with no way to recover. When only the builder step is
              missing we run just that, rather than re-prompting for the agent
              signature the user already gave. */}
          {(!agent.isReady || !builderApproved) && (
            <button
              type="button"
              onClick={agent.isReady ? agent.approveBuilder : agent.onboard}
              disabled={agent.onboarding}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-up py-3.5 font-semibold text-black transition-transform active:scale-95 disabled:opacity-60"
            >
              {agent.onboarding && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={18}
                  className="animate-spin"
                />
              )}
              {agent.onboarding
                ? "Approve in wallet…"
                : agent.isReady
                  ? "Approve builder code"
                  : "Enable one-tap trading"}
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="glass-inset mt-1 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium text-text-muted transition-colors hover:text-down"
          >
            <HugeiconsIcon icon={Logout01Icon} size={18} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

// One half of the funding / trading split inside the balance card.
function BalanceCell({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="flex-1 rounded-xl bg-[#08090C] px-3 py-2">
      <div className="text-[11px] text-text-muted">{label}</div>
      <div className="tabular text-sm font-semibold">
        {value != null ? formatUsd(value) : "—"}
      </div>
    </div>
  );
}

// One of the four money actions under the balance card: a round glass icon with
// its label beneath. Deposit is the primary one and wears the brand green.
function ActionButton({
  icon,
  label,
  onClick,
  primary,
  disabled,
}: {
  icon: typeof Download04Icon;
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        playSound("tap");
        haptic("tap");
        onClick();
      }}
      className="flex flex-col items-center gap-1.5 transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-full ${primary ? "bg-up text-black" : "glass text-text"
          }`}
      >
        <HugeiconsIcon icon={icon} size={20} />
      </span>
      <span className="text-[11px] font-medium text-text-muted">{label}</span>
    </button>
  );
}

// Transfer sheet (sub-view of the Account sheet). Move USDC between the user's
// Privy wallet and their Bulk trading collateral. Direction is switchable:
//   Wallet → Trading  = deposit into Bulk (via depositCollateral)
//   Trading → Wallet  = withdraw from Bulk (via withdrawCollateral)
// Plus a "Fund wallet" action (Privy on-ramp) to top up the Privy wallet itself.
function TransferPanel({
  collateral,
  masterAddress,
  initialDir,
}: {
  collateral: ReturnType<typeof useCollateral>;
  masterAddress: string | null;
  /** Direction the panel opens in — set by the action button that opened it. */
  initialDir: "in" | "out";
}) {
  const { fundWallet } = useFundWallet();
  // dir: which way the transfer moves. "in" = wallet→trading (deposit),
  // "out" = trading→wallet (withdraw).
  const [dir, setDir] = useState<"in" | "out">(initialDir);
  const [amount, setAmount] = useState<string>("25");

  const walletUsdc = collateral.walletUsdc;
  const available = collateral.available;
  const amt = Number(amount) || 0;

  // The "from" and "to" labels + balances, driven by direction.
  const from =
    dir === "in"
      ? { label: "Wallet", bal: walletUsdc }
      : { label: "Trading", bal: available };
  const to =
    dir === "in"
      ? { label: "Trading", bal: available }
      : { label: "Wallet", bal: walletUsdc };

  const isDeposit = dir === "in";
  const overBalance = from.bal != null && amt > from.bal;
  const canSubmit =
    amt > 0 && !overBalance && !collateral.busy && !!masterAddress;

  const submit = () => {
    if (!canSubmit) return;
    playSound("tap");
    haptic("tap");
    // Wallet→Trading = deposit into Bulk; Trading→Wallet = withdraw from Bulk.
    if (isDeposit) collateral.deposit(amt);
    else collateral.withdraw(amt);
  };

  const swap = () => {
    playSound("tap");
    haptic("tap");
    setDir((d) => (d === "in" ? "out" : "in"));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* From / To with a swap button at the seam (mirrors the menu cards). */}
      <div className="relative flex flex-col gap-2">
        <TransferRow label={`From · ${from.label}`} balance={from.bal} />
        <button
          type="button"
          onClick={swap}
          aria-label="Swap direction"
          className="glass absolute left-1/2 top-1/2 z-10 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-bg-elevated text-text shadow-lg transition-transform active:scale-90"
        >
          <HugeiconsIcon icon={ArrowDataTransferVerticalIcon} size={16} />
        </button>
        <TransferRow label={`To · ${to.label}`} balance={to.bal} />
      </div>

      {/* Amount */}
      <div className="glass-inset rounded-2xl p-4">
        <div className="mb-1 text-xs text-text-muted">Amount (USDC)</div>
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
          {from.bal != null && (
            <button
              type="button"
              onClick={() => setAmount(String(from.bal))}
              className="rounded-lg bg-white/5 px-2 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:text-text"
            >
              MAX
            </button>
          )}
        </div>
        {overBalance && (
          <div className="mt-1 text-[10px] text-down">
            Exceeds {from.label.toLowerCase()} balance
          </div>
        )}
      </div>

      {/* Primary action — follows direction. Both move funds between the Privy
          wallet and Bulk trading collateral (deposit / withdraw). */}
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-up py-3.5 font-semibold text-black transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {collateral.busy && (
          <HugeiconsIcon icon={Loading03Icon} size={18} className="animate-spin" />
        )}
        {isDeposit ? "Deposit" : "Withdraw"}
      </button>

      {/* Secondary — Privy on-ramp to top up the Privy wallet itself. */}
      <button
        type="button"
        onClick={() => {
          if (!masterAddress) return;
          playSound("tap");
          haptic("tap");
          void fundWallet(masterAddress);
        }}
        className="glass-inset flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium text-text-muted transition-colors hover:text-text"
      >
        <HugeiconsIcon icon={Wallet01Icon} size={18} />
        Fund wallet
      </button>
    </div>
  );
}

// One balance row in the transfer sheet (From / To).
function TransferRow({
  label,
  balance,
}: {
  label: string;
  balance: number | null | undefined;
}) {
  return (
    <div className="glass-inset flex items-center justify-between rounded-2xl px-4 py-3.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="tabular text-sm font-semibold">
        {balance != null ? formatUsd(balance) : "—"}
      </span>
    </div>
  );
}

function NavRow({
  icon,
  label,
  detail,
  status,
  onClick,
  disabled,
}: {
  icon: typeof Settings02Icon;
  label: string;
  /** Muted text on the right, before the chevron. */
  detail?: string;
  /** Renders a state dot instead of a chevron: done = green, pending = amber. */
  status?: "done" | "pending";
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45"
    >
      <HugeiconsIcon icon={icon} size={18} className="shrink-0 text-text-muted" />
      <span className="flex-1 text-left">{label}</span>
      {detail && (
        <span className="tabular shrink-0 text-xs text-text-muted">{detail}</span>
      )}
      {status ? (
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          size={17}
          className={`shrink-0 ${status === "done" ? "text-up" : "text-text-muted/40"}`}
        />
      ) : (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={16}
          className="shrink-0 text-text-muted"
        />
      )}
    </button>
  );
}
