"use client";

import { useEffect, useState } from "react";
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
  ArrowDown01Icon,
  HelpCircleIcon,
  Download04Icon,
} from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetDemo } from "@/store/slices/tradingModeSlice";
import { formatUsd } from "@/lib/format";
import { SettingsPanel } from "./panels/SettingsPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import type { ShareSubject } from "@/components/share/ShareCardModal";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { useCollateral } from "@/hooks/useCollateral";

type View = "menu" | "settings" | "history" | "transfer";

interface Props {
  open: boolean;
  onClose: () => void;
  agent: ReturnType<typeof useAgentWallet>;
  onOpenTutorial: () => void;
  onOpenInstall: () => void;
  onShare: (subject: ShareSubject) => void;
}

const TITLES: Record<View, string> = {
  menu: "Account",
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

  const mode = useAppSelector((s) => s.tradingMode.mode);
  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const liveEquity = useAppSelector((s) => s.user.balance?.equity);
  const agentAuthorized = useAppSelector((s) => s.trading.agentAuthorized);
  const builderApproved = useAppSelector((s) => s.trading.builderApproved);
  const collateral = useCollateral(agent.masterAddress, agent.masterSign);

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
            className="glass fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-3xl p-4 pb-8"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-white/15" />

            {/* Header: back button (sub-views) + title */}
            <div className="relative mb-3 flex h-6 shrink-0 items-center justify-center">
              {view !== "menu" && (
                <button
                  type="button"
                  onClick={() => go("menu")}
                  aria-label="Back"
                  className="absolute left-0 flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-text active:scale-90"
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
                </button>
              )}
              <span className="text-sm font-medium text-text-muted">
                {TITLES[view]}
              </span>
            </div>

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
                      onTransfer={() => go("transfer")}
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
  onTransfer: () => void;
  onTutorial: () => void;
  onInstall: () => void;
}) {
  const { fundWallet } = useFundWallet();
  // Privy on-ramp: top up the user's OWN Solana wallet with USDC from outside.
  const onFundWallet = () => {
    if (!agent.masterAddress) return;
    playSound("tap");
    haptic("tap");
    void fundWallet(agent.masterAddress);
  };

  return (
    <div className="flex flex-col">
      {/* Balance. DEMO: a single simulated figure. LIVE: the two-balance model —
          the user's own wallet USDC and their Bulk trading collateral (split into
          free/in-use), which the collateral dock moves between. */}
      {mode === "demo" ? (
        <div className="glass-inset mb-4 rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs text-text-muted">
            <span>Demo balance</span>
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-text-muted">
              DEMO
            </span>
          </div>
          <div className="tabular text-2xl font-semibold">
            {formatUsd(demoBalance)}
          </div>
        </div>
      ) : (
        // DEX-style: Wallet card and Trading card stacked, with a floating swap
        // button at the seam that opens the transfer sheet.
        <div className="relative mb-4 flex flex-col gap-2">
          {/* Wallet (the user's own USDC) + Deposit / Withdraw buttons */}
          <div className="glass-inset rounded-2xl p-4">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>Wallet balance</span>
            </div>
            <div className="tabular text-xl font-semibold">
              {collateral.walletUsdc != null
                ? formatUsd(collateral.walletUsdc)
                : "—"}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onFundWallet}
                className="rounded-xl bg-up-soft py-2 text-xs font-semibold text-up transition-transform active:scale-95"
              >
                Deposit
              </button>
              <button
                type="button"
                disabled
                className="rounded-xl bg-white/5 py-2 text-xs font-semibold text-text-muted opacity-50"
              >
                Withdraw
              </button>
            </div>
          </div>

          {/* Swap button at the seam — opens the transfer sheet. Sits centered
              over the gap so it reads as connecting both cards (DEX style). */}
          <button
            type="button"
            onClick={() => {
              playSound("tap");
              haptic("tap");
              onTransfer();
            }}
            aria-label="Transfer margin"
            className="glass absolute left-1/2 top-1/2 z-10 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-bg-elevated text-text shadow-lg transition-transform active:scale-90"
          >
            <HugeiconsIcon icon={ArrowDataTransferVerticalIcon} size={18} />
          </button>

          {/* Trading collateral (Bulk) — equity + free / in-use split */}
          <div className="glass-inset rounded-2xl p-4">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>Trading collateral</span>
            </div>
            <div className="tabular text-xl font-semibold">
              {liveEquity != null ? formatUsd(liveEquity) : "—"}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                <div className="text-text-muted">Free</div>
                <div className="tabular font-semibold text-up">
                  {formatUsd(collateral.available)}
                </div>
              </div>
              <div className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                <div className="text-text-muted">In use</div>
                <div className="tabular font-semibold">
                  {formatUsd(collateral.inUse)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="mb-4 flex flex-col gap-2">
        <NavRow icon={Settings02Icon} label="Settings" onClick={onSettings} />
        <NavRow icon={Clock01Icon} label="Trade history" onClick={onHistory} />
        <NavRow icon={HelpCircleIcon} label="How it works" onClick={onTutorial} />
        <NavRow icon={Download04Icon} label="Install app" onClick={onInstall} />
      </div>

      {/* Mode-specific actions */}
      {mode === "demo" ? (
        <button
          type="button"
          onClick={onResetDemo}
          className="glass-inset w-full rounded-2xl py-3 text-sm font-medium text-text-muted transition-colors hover:text-text"
        >
          Reset demo balance
        </button>
      ) : !authenticated ? (
        <button
          type="button"
          onClick={onLogin}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-up py-3.5 font-semibold text-black transition-transform active:scale-95"
        >
          <HugeiconsIcon icon={Wallet01Icon} size={20} />
          Connect wallet
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <OnboardRow label="Agent wallet authorized" done={agentAuthorized} />
          <OnboardRow label="Builder code approved" done={builderApproved} />

          {!agent.isReady && (
            <button
              type="button"
              onClick={agent.onboard}
              disabled={agent.onboarding}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-up py-3.5 font-semibold text-black transition-transform active:scale-95 disabled:opacity-60"
            >
              {agent.onboarding && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={18}
                  className="animate-spin"
                />
              )}
              {agent.onboarding ? "Approve in wallet…" : "Enable one-tap trading"}
            </button>
          )}

          <button
            type="button"
            onClick={onLogout}
            className="glass-inset mt-1 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium text-text-muted transition-colors hover:text-down"
          >
            <HugeiconsIcon icon={Logout01Icon} size={18} />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function NavRow({
  icon,
  label,
  onClick,
}: {
  icon: typeof Settings02Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-inset flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-colors hover:bg-white/10 active:scale-[0.98]"
    >
      <HugeiconsIcon icon={icon} size={18} className="text-text-muted" />
      <span className="flex-1 text-left">{label}</span>
      <HugeiconsIcon icon={ArrowRight01Icon} size={16} className="text-text-muted" />
    </button>
  );
}

function OnboardRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="glass-inset flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm">
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        size={18}
        className={done ? "text-up" : "text-text-muted/40"}
      />
      <span className={done ? "text-text" : "text-text-muted"}>{label}</span>
    </div>
  );
}
