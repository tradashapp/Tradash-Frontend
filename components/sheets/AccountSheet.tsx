"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
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
  HelpCircleIcon,
  Download04Icon,
} from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { resetDemo } from "@/store/slices/tradingModeSlice";
import { formatUsd } from "@/lib/format";
import { SettingsPanel } from "./panels/SettingsPanel";
import { HistoryPanel } from "./panels/HistoryPanel";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { useAgentWallet } from "@/hooks/useAgentWallet";

type View = "menu" | "settings" | "history";

interface Props {
  open: boolean;
  onClose: () => void;
  agent: ReturnType<typeof useAgentWallet>;
  onOpenTutorial: () => void;
  onOpenInstall: () => void;
}

const TITLES: Record<View, string> = {
  menu: "Account",
  settings: "Settings",
  history: "Trade history",
};

// Central account hub. A single sheet with sub-views (menu → settings/history)
// navigated by a back icon in the top-left, rather than separate sheets.
export function AccountSheet({
  open,
  onClose,
  agent,
  onOpenTutorial,
  onOpenInstall,
}: Props) {
  const dispatch = useAppDispatch();
  const { login, logout, authenticated } = usePrivy();
  const [view, setView] = useState<View>("menu");

  const mode = useAppSelector((s) => s.tradingMode.mode);
  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const liveEquity = useAppSelector((s) => s.user.balance?.equity);
  const agentAuthorized = useAppSelector((s) => s.trading.agentAuthorized);
  const builderApproved = useAppSelector((s) => s.trading.builderApproved);

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
                      authenticated={authenticated}
                      agent={agent}
                      agentAuthorized={agentAuthorized}
                      builderApproved={builderApproved}
                      onResetDemo={() => dispatch(resetDemo())}
                      onLogin={login}
                      onLogout={logout}
                      onSettings={() => go("settings")}
                      onHistory={() => go("history")}
                      onTutorial={onOpenTutorial}
                      onInstall={onOpenInstall}
                    />
                  )}
                  {view === "settings" && <SettingsPanel />}
                  {view === "history" && <HistoryPanel />}
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
  authenticated,
  agent,
  agentAuthorized,
  builderApproved,
  onResetDemo,
  onLogin,
  onLogout,
  onSettings,
  onHistory,
  onTutorial,
  onInstall,
}: {
  mode: "demo" | "live";
  demoBalance: number;
  liveEquity: number | undefined;
  authenticated: boolean;
  agent: ReturnType<typeof useAgentWallet>;
  agentAuthorized: boolean;
  builderApproved: boolean;
  onResetDemo: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onTutorial: () => void;
  onInstall: () => void;
}) {
  return (
    <div className="flex flex-col">
      {/* Balance — with a small mode badge (toggle lives in Settings now). */}
      <div className="glass-inset mb-4 rounded-2xl p-4">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{mode === "demo" ? "Demo balance" : "Account equity"}</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
              mode === "demo" ? "bg-white/10 text-text-muted" : "bg-up-soft text-up"
            }`}
          >
            {mode === "demo" ? "DEMO" : "LIVE"}
          </span>
        </div>
        <div className="tabular text-2xl font-semibold">
          {mode === "demo"
            ? formatUsd(demoBalance)
            : liveEquity != null
              ? formatUsd(liveEquity)
              : "—"}
        </div>
        {mode === "live" && (
          <div className="mt-1 text-[10px] leading-tight text-text-muted">
            Settled figure from Bulk (includes funding fees). On-chart PnL is a
            live estimate.
          </div>
        )}
      </div>

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
