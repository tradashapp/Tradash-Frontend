"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { marginHealth } from "@/lib/perp";
import { Connection, Transaction } from "@solana/web3.js";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import { api } from "@/lib/api";
import { solanaRpcUrl } from "@/lib/config";
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
/** A UUID for the idempotency key, with a fallback for non-secure contexts. */
function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))
    ).toString(16)
  );
}

export function useCollateral(
  masterAddress: string | null,
  masterSign: MasterSignBytes | null
) {
  const { toast } = useToast();
  // Deposits are on-chain transactions signed by the user's wallet, not Bulk
  // API calls — see lib/solana/bulkVault.ts for why.
  //
  // `signTransaction`, not `sendTransaction`: the backend builds and
  // fee-payer-signs these, so the user adds a signature and the BACKEND
  // broadcasts. Sending from here would drop the sponsor's signature.
  const { signTransaction } = useSignTransaction();
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

  /**
   * Run one sponsored vault transfer end to end.
   *
   * The backend builds the instruction and signs the fee; the wallet signs as
   * the vault owner; the backend broadcasts. The user needs no SOL, which is
   * the whole point — before this, a wallet funded only with USDC could not
   * move it into trading at all.
   */
  const sponsoredTransfer = useCallback(
    async (amount: number, direction: "deposit" | "withdraw") => {
      // Sponsored vault transfers are a mainnet rail; devnet collateral comes
      // from the faucet. The backend enforces this too — checking here turns a
      // server round trip into an immediate, clearer message.
      if (config.bulk.network !== "mainnet") {
        throw new Error("Vault transfers are mainnet-only (testnet uses the faucet).");
      }
      // Minted once per attempt so a retry inside it reuses the same key.
      const key = uuid();
      const prepared = await api.prepareTransfer(amount, direction);
      const tx = Transaction.from(
        Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0))
      );
      const connection = new Connection(solanaRpcUrl(), "confirmed");
      const signed = await signTransaction({ transaction: tx, connection });
      const serialized = (signed as Transaction).serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      // Built byte by byte: String.fromCharCode(...bytes) blows the call stack
      // on a large transaction.
      let binary = "";
      for (const byte of serialized) binary += String.fromCharCode(byte);
      return api.submitTransfer(btoa(binary), amount, direction, key);
    },
    [signTransaction]
  );

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
        await sponsoredTransfer(amount, "deposit");
        toast(`Deposited ${fmtUsd(amount)}`, {
          type: "success",
          id: "collateral",
          description: "Added to your trading collateral. Fee paid by Tradash.",
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
      sponsoredTransfer,
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
        await sponsoredTransfer(amount, "withdraw");
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
      sponsoredTransfer,
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
