"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { marginHealth } from "@/lib/perp";
import { buildDepositTx, buildWithdrawIntentTx } from "@/lib/solana/bulkVault";
import { PublicKey } from "@solana/web3.js";
import { useSendTransaction } from "@privy-io/react-auth/solana";
import { readUsdcBalance } from "@/lib/solana/usdc";
import { config } from "@/lib/config";
import { useToast } from "@/components/toast/ToastProvider";
import type { MasterSignBytes } from "@/lib/bulk/onboarding";

// Bulk collateral withdrawal (trading account → Privy wallet) is enabled. (The
// separate WALLET → external-address off-ramp remains disabled — that's a
// different, later action.)
export const WITHDRAW_ENABLED = true;

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
 * Both deposit (wallet → Bulk) and withdraw (Bulk → wallet) are live external
 * transfers (master-signed). In demo mode there is no external wallet, so
 * deposit/withdraw are informational.
 */
export function useCollateral(
  masterAddress: string | null,
  masterSign: MasterSignBytes | null
) {
  const { toast } = useToast();
  // Deposits are on-chain transactions signed by the user's wallet, not Bulk
  // API calls — see lib/solana/bulkVault.ts for why.
  const { sendTransaction } = useSendTransaction();
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
      // Guard the deposit against the wallet balance on MAINNET only.
      //
      // Not on testnet: there the account is faucet-funded and holds no real
      // Privy-wallet USDC, so this check reported "not enough" even when the
      // user had plenty of collateral. On mainnet the transfer moves actual
      // funds, and Bulk rejects an over-balance deposit with an opaque error —
      // so catching it here is the difference between a clear message and an
      // unexplained failure. `walletUsdc` is null when the balance is unknown
      // (RPC hiccup), and an unknown balance must not block a legitimate
      // deposit — so only a KNOWN, insufficient balance stops it.
      if (
        config.bulk.network === "mainnet" &&
        walletUsdc !== null &&
        amount > walletUsdc
      ) {
        toast("Not enough USDC", {
          type: "error",
          description: `Your wallet holds ${fmtUsd(walletUsdc)}.`,
        });
        return;
      }

      setBusy(true);
      toast(`Depositing ${fmtUsd(amount)}…`, { type: "loading", id: "collateral" });
      try {
        const { tx, connection } = await buildDepositTx(
          new PublicKey(masterAddress),
          amount
        );
        await sendTransaction({ transaction: tx, connection });
        toast(`Deposited ${fmtUsd(amount)}`, {
          type: "success",
          id: "collateral",
          description: "Added to your trading collateral.",
        });
        // Wallet balance dropped; refresh it. Bulk credits the account from the
        // on-chain deposit, so equity follows over the WS a moment later.
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
    [
      mode,
      masterAddress,
      masterSign,
      toast,
      refreshWallet,
      walletUsdc,
      sendTransaction,
    ]
  );

  const withdraw = useCallback(
    async (amount: number) => {
      if (amount <= 0) return;
      if (mode === "demo") {
        toast("Withdrawals are live-mode only", { type: "info" });
        return;
      }
      if (!masterAddress || !masterSign) {
        toast("Connect wallet to withdraw", { type: "error" });
        return;
      }
      if (amount > health.maxWithdrawable) {
        toast("Exceeds withdrawable collateral", {
          type: "error",
          description: `Up to ${fmtUsd(health.maxWithdrawable)} is free to withdraw.`,
        });
        return;
      }
      setBusy(true);
      toast(`Withdrawing ${fmtUsd(amount)}…`, { type: "loading", id: "collateral" });
      try {
        const { tx, connection } = await buildWithdrawIntentTx(
          new PublicKey(masterAddress),
          amount
        );
        await sendTransaction({ transaction: tx, connection });
        // A withdrawal INTENT: the instruction signals the request and moves no
        // tokens itself, so the wallet balance does not change on this tick —
        // Bulk pays out from the vault after observing it. Worded as "on its
        // way" rather than "moved" so the user isn't told to expect funds that
        // have not landed yet.
        toast("Withdrawal requested", {
          type: "success",
          id: "collateral",
          description: `${fmtUsd(amount)} is on its way to your wallet.`,
        });
        void refreshWallet();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Withdraw failed";
        toast("Withdraw failed", {
          type: "error",
          id: "collateral",
          description: msg.replace(/^Bulk order error:\s*/, ""),
        });
      } finally {
        setBusy(false);
      }
    },
    [
      mode,
      masterAddress,
      masterSign,
      health.maxWithdrawable,
      toast,
      refreshWallet,
      sendTransaction,
    ]
  );

  // Memoised for the same reason as `useWithdrawal`: consumers put this object
  // in dependency arrays, and a new literal every render turned the 30s wallet
  // poll above into a re-render that reset unrelated timers elsewhere in the
  // sheet.
  return useMemo(
    () => ({
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
    }),
    [
      mode,
      walletUsdc,
      liveBalance?.equity,
      demoBalance,
      health.available,
      health.inUse,
      health.ratio,
      health.maxWithdrawable,
      busy,
      deposit,
      withdraw,
      refreshWallet,
    ]
  );
}
