"use client";

import { uuid } from "@/lib/uuid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { marginHealth } from "@/lib/perp";
import { Connection, Transaction } from "@solana/web3.js";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import { api } from "@/lib/api";
import { solanaRpcUrl } from "@/lib/config";
import { readUsdcBalance } from "@/lib/solana/usdc";
import { config } from "@/lib/config";
import { venue } from "@/lib/venue";
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

  /**
   * Re-read the wallet until it reflects a transfer that just landed.
   *
   * A single read right after the toast races the RPC's own view: the node may
   * still serve the pre-transfer balance. Meanwhile trading collateral updates
   * instantly over the WS, so the total (trading + funding) briefly counted the
   * moved amount TWICE — $10 + $5 showing as $15 before settling back to $10.
   *
   * Polling until the value actually moves closes that window. It gives up
   * after a few tries and leaves the 30s poll to correct it, rather than
   * spinning forever on a transfer whose size we cannot predict exactly.
   */
  const refreshWalletUntilChanged = useCallback(
    async (previous: number | null) => {
      for (let attempt = 0; attempt < 6; attempt++) {
        if (mode !== "live" || !masterAddress) return;
        try {
          const next = await readUsdcBalance(masterAddress);
          if (previous == null || next !== previous) {
            setWalletUsdc(next);
            return;
          }
        } catch {
          // Transient RPC failure — keep the last known value and try again.
        }
        await new Promise((r) => setTimeout(r, 800));
      }
      // Never changed: take whatever the chain says now rather than holding a
      // value we know is stale.
      void refreshWallet();
    },
    [mode, masterAddress, refreshWallet]
  );

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

  /**
   * Move collateral, through whichever venue is active.
   *
   * Bulk routes through the backend sponsor (`sponsoredTransfer`), which
   * partial-signs a vault transfer so the user needs no SOL. Phoenix builds a
   * single owner-signed instruction instead — the SDK handles the Ember
   * conversion internally, so there is no multi-step orchestration to mirror.
   *
   * In BOTH cases the OWNER signs: a delegate that can trade must never be able
   * to move funds, and Phoenix enforces that at the venue (its deposit and
   * withdraw inputs carry no `positionAuthority` field at all).
   */
  const moveCollateral = useCallback(
    async (amount: number, direction: "deposit" | "withdraw") => {
      if (venue.id !== "phoenix") {
        await sponsoredTransfer(amount, direction);
        return;
      }
      if (!masterAddress) throw new Error("Connect wallet to move collateral");
      const { depositCollateral, withdrawCollateral } = await import(
        "@/lib/phoenix/collateral"
      );
      const move = direction === "deposit" ? depositCollateral : withdrawCollateral;
      await move({
        owner: masterAddress,
        amountUsd: amount,
        rpcUrl: solanaRpcUrl(),
        signTransaction: signTransaction as never,
      });
    },
    [masterAddress, sponsoredTransfer, signTransaction]
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
        const before = walletUsdc;
        await moveCollateral(amount, "deposit");
        toast(`Deposited ${fmtUsd(amount)}`, {
          type: "success",
          id: "collateral",
          description: "Added to your trading collateral.",
        });
        // Wallet balance dropped; poll until the RPC agrees. Bulk credits the
        // account from the on-chain deposit, so equity follows over the WS a
        // moment later — reading once here would race that and double-count.
        void refreshWalletUntilChanged(before);
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
      refreshWalletUntilChanged,
      walletUsdc,
      moveCollateral,
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
        await moveCollateral(amount, "withdraw");
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
      moveCollateral,
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
