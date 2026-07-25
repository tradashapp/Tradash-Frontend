"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Wallet01Icon,
  CheckmarkCircle02Icon,
  Loading03Icon,
  Logout01Icon,
} from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { setMode, resetDemo } from "@/store/slices/tradingModeSlice";
import { formatUsd } from "@/lib/format";
import type { useAgentWallet } from "@/hooks/useAgentWallet";

interface Props {
  open: boolean;
  onClose: () => void;
  agent: ReturnType<typeof useAgentWallet>;
}

// Central account hub (bottom sheet like the market switcher): switch Demo/Live,
// see balance, connect wallet, run onboarding. Keeps the chart clean — nothing
// permanent on screen.
export function AccountSheet({ open, onClose, agent }: Props) {
  const dispatch = useAppDispatch();
  const { login, logout, authenticated } = usePrivy();

  const mode = useAppSelector((s) => s.tradingMode.mode);
  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const liveEquity = useAppSelector((s) => s.user.balance?.equity);
  const agentAuthorized = useAppSelector((s) => s.trading.agentAuthorized);
  const builderApproved = useAppSelector((s) => s.trading.builderApproved);

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
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl bg-bg-elevated p-4 pb-8"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />

            {/* Demo / Live segmented toggle */}
            <div className="mb-4 flex rounded-2xl bg-bg-overlay p-1">
              {(["demo", "live"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => dispatch(setMode(m))}
                  className={`flex-1 rounded-xl py-2 text-sm font-semibold capitalize transition-colors ${
                    mode === m
                      ? m === "live"
                        ? "bg-up text-black"
                        : "bg-white/10 text-text"
                      : "text-text-muted"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Balance */}
            <div className="mb-4 rounded-2xl bg-bg-overlay p-4">
              <div className="text-xs text-text-muted">
                {mode === "demo" ? "Demo balance" : "Account equity"}
              </div>
              <div className="tabular text-2xl font-semibold">
                {mode === "demo"
                  ? formatUsd(demoBalance)
                  : liveEquity != null
                    ? formatUsd(liveEquity)
                    : "—"}
              </div>
            </div>

            {/* Mode-specific actions */}
            {mode === "demo" ? (
              <button
                type="button"
                onClick={() => dispatch(resetDemo())}
                className="w-full rounded-2xl bg-bg-overlay py-3 text-sm font-medium text-text-muted transition-colors hover:text-text"
              >
                Reset demo balance
              </button>
            ) : !authenticated ? (
              <button
                type="button"
                onClick={() => login()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-up py-3.5 font-semibold text-black transition-transform active:scale-95"
              >
                <HugeiconsIcon icon={Wallet01Icon} size={20} />
                Connect wallet
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                {/* Onboarding status */}
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
                  onClick={() => logout()}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-2xl bg-bg-overlay py-3 text-sm font-medium text-text-muted transition-colors hover:text-down"
                >
                  <HugeiconsIcon icon={Logout01Icon} size={18} />
                  Disconnect
                </button>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function OnboardRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-bg-overlay px-3 py-2.5 text-sm">
      <HugeiconsIcon
        icon={CheckmarkCircle02Icon}
        size={18}
        className={done ? "text-up" : "text-text-muted/40"}
      />
      <span className={done ? "text-text" : "text-text-muted"}>{label}</span>
    </div>
  );
}
