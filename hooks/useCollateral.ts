"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { marginHealth } from "@/lib/perp";
import { depositCollateral } from "@/lib/bulk/onboarding";
import { readUsdcBalance } from "@/lib/solana/usdc";
import { useToast } from "@/components/toast/ToastProvider";
import type { MasterSignBytes } from "@/lib/bulk/onboarding";

// Phase B gate: Bulk collateral WITHDRAWAL (trading account → Privy wallet) is
// not yet verified against live Bulk, so it's disabled behind this flag. Flip to
// true once the reverse-transfer payload is confirmed working. Deposit is live.
export const WITHDRAW_ENABLED = false;

const fmtUsd = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Account-collateral management (cross margin). Surfaces the TWO balances — the
 * user's own Privy wallet USDC and their Bulk trading collateral (available /
 * in-use / health) — and the deposit/withdraw transfers between them.
 *
 * Deposit is live (reuses the verified `depositCollateral`). Withdraw is gated
 * behind WITHDRAW_ENABLED until the Bulk reverse-transfer is verified. In demo
 * mode there is no external wallet, so deposit/withdraw are informational.
 */
export function useCollateral(
  masterAddress: string | null,
  masterSign: MasterSignBytes | null
) {
  const { toast } = useToast();
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const liveBalance = useAppSelector((s) => s.user.balance);
  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);

  const health = marginHealth(mode === "live" ? liveBalance : null);

  // The user's own wallet USDC (live only). Polled lightly; also refreshed right
  // after a deposit so the panel reflects the new wallet balance.
  const [walletUsdc, setWalletUsdc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshWallet = useCallback(async () => {
    if (mode !== "live" || !masterAddress) {
      setWalletUsdc(null);
      return;
    }
    try {
      setWalletUsdc(await readUsdcBalance(masterAddress));
    } catch {
      setWalletUsdc(null); // RPC hiccup — leave it unknown rather than wrong.
    }
  }, [mode, masterAddress]);

  const walletRef = useRef(refreshWallet);
  walletRef.current = refreshWallet;
  useEffect(() => {
    walletRef.current();
    const id = setInterval(() => walletRef.current(), 30_000);
    return () => clearInterval(id);
  }, [masterAddress, mode]);

  const deposit = useCallback(
    async (amount: number) => {
      if (amount <= 0) return;
      if (mode === "demo") {
        toast("Deposits are live-mode only", {
          type: "info",
          description: "Demo uses a simulated balance you can reset anytime.",
        });
        return;
      }
      if (!masterAddress || !masterSign) {
        toast("Connect wallet to deposit", { type: "error" });
        return;
      }
      if (walletUsdc != null && amount > walletUsdc) {
        toast("Not enough wallet USDC", {
          type: "error",
          description: `Wallet holds ${fmtUsd(walletUsdc)}.`,
        });
        return;
      }
      setBusy(true);
      toast(`Depositing ${fmtUsd(amount)}…`, { type: "loading", id: "collateral" });
      try {
        await depositCollateral(masterAddress, amount, masterSign);
        toast(`Deposited ${fmtUsd(amount)}`, {
          type: "success",
          id: "collateral",
          description: "Added to your trading collateral.",
        });
        // Wallet balance dropped; refresh it. Bulk equity updates via the WS.
        void refreshWallet();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Deposit failed";
        toast("Deposit failed", {
          type: "error",
          id: "collateral",
          description: msg.replace(/^Bulk order error:\s*/, ""),
        });
      } finally {
        setBusy(false);
      }
    },
    [mode, masterAddress, masterSign, walletUsdc, toast, refreshWallet]
  );

  const withdraw = useCallback(
    async (amount: number) => {
      if (amount <= 0) return;
      if (mode === "demo") {
        toast("Withdrawals are live-mode only", { type: "info" });
        return;
      }
      if (!WITHDRAW_ENABLED) {
        toast("Withdraw coming soon", {
          type: "info",
          description: "Collateral withdrawal is being finalized.",
        });
        return;
      }
      if (amount > health.maxWithdrawable) {
        toast("Exceeds withdrawable collateral", {
          type: "error",
          description: `Up to ${fmtUsd(health.maxWithdrawable)} is free to withdraw.`,
        });
        return;
      }
      // Phase B: wire withdrawCollateral(masterAddress, amount, masterSign) here.
    },
    [mode, health.maxWithdrawable, toast]
  );

  return {
    mode,
    walletUsdc, // user's own Privy wallet USDC (live) or null
    equity: mode === "live" ? liveBalance?.equity ?? null : demoBalance,
    available: health.available,
    inUse: health.inUse,
    health: health.ratio,
    maxWithdrawable: health.maxWithdrawable,
    busy,
    deposit,
    withdraw,
    withdrawEnabled: WITHDRAW_ENABLED,
    refreshWallet,
  };
}
