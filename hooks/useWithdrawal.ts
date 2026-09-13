"use client";

import { useCallback, useEffect, useState } from "react";
import { Connection, Transaction } from "@solana/web3.js";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import { api, ApiError } from "@/lib/api";
import type { Movement, RecipientCheck, SavedAddress } from "@/lib/api";
import { solanaRpcUrl } from "@/lib/config";
import { useToast } from "@/components/toast/ToastProvider";

/**
 * External USDC withdrawals: wallet → any outside Solana address.
 *
 * Distinct from `useCollateral`, which moves funds between the user's own two
 * balances (wallet ↔ Bulk trading collateral). This one sends money OUT, so it
 * carries the extra machinery that implies: recipient validation, an address
 * book, and a gas sponsor so the user needs no SOL.
 *
 * The signing flow is deliberately two-step. The backend builds and
 * fee-payer-signs the transaction (step 1), the user's wallet adds its
 * signature here, and the backend broadcasts it (step 2). The client never
 * constructs the instruction, so it cannot smuggle one past the sponsor.
 */

const fmtUsd = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Human-readable message for an API failure. */
function apiMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "Daily withdrawal limit reached. Try tomorrow.";
    if (e.status === 503) return "Withdrawals are temporarily unavailable.";
    if (e.status === 401) return "Please sign in again.";
  }
  return e instanceof Error ? e.message : fallback;
}

export function useWithdrawal() {
  const { toast } = useToast();
  const { signTransaction } = useSignTransaction();

  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [movements, setMovements] = useState<Movement[] | null>(null);

  const refreshAddresses = useCallback(async () => {
    try {
      setAddresses(await api.fetchAddressBook());
    } catch {
      // A missing address book must not block a withdrawal — it is a
      // convenience, so failure just means an empty list.
      setAddresses([]);
    }
  }, []);

  const refreshMovements = useCallback(async () => {
    try {
      setMovements(await api.fetchMovements());
    } catch {
      setMovements([]);
    }
  }, []);

  useEffect(() => {
    void refreshAddresses();
  }, [refreshAddresses]);

  /**
   * Validate a recipient. Debounced by the caller — this hits the chain to see
   * whether the address has a USDC account, so it should not run per keystroke.
   */
  const inspect = useCallback(
    async (address: string): Promise<RecipientCheck | null> => {
      if (!address.trim()) return null;
      setChecking(true);
      try {
        return await api.inspectRecipient(address.trim());
      } catch {
        return null;
      } finally {
        setChecking(false);
      }
    },
    []
  );

  /**
   * Send USDC to an outside address, with the app paying the network fee.
   *
   * Returns the signature on success, null on failure (the toast explains).
   */
  const withdraw = useCallback(
    async (to: string, amount: number): Promise<string | null> => {
      if (amount <= 0) return null;
      setBusy(true);
      toast(`Sending ${fmtUsd(amount)}…`, { type: "loading", id: "withdraw" });

      try {
        // Step 1 — the backend builds it and signs the fee. Nothing has moved.
        const prepared = await api.prepareWithdrawal(to, amount);

        // Step 2 — the user signs as the transfer authority. `signTransaction`
        // (not `sendTransaction`) so the fee payer's signature survives and the
        // backend, not the browser, does the broadcast.
        const tx = Transaction.from(
          Uint8Array.from(atob(prepared.transaction), (c) => c.charCodeAt(0))
        );
        const connection = new Connection(solanaRpcUrl(), "confirmed");
        const signed = await signTransaction({ transaction: tx, connection });

        const serialized = (signed as Transaction).serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
        // btoa needs a binary string. Built byte by byte rather than with
        // String.fromCharCode(...bytes), which blows the call stack on a large
        // transaction by spreading every byte as an argument.
        let binary = "";
        for (const byte of serialized) binary += String.fromCharCode(byte);

        // Step 3 — broadcast, audit and record.
        const { signature } = await api.submitWithdrawal(
          btoa(binary),
          to,
          amount
        );

        toast(`Sent ${fmtUsd(amount)}`, {
          type: "success",
          id: "withdraw",
          description: "Network fee paid by Tradash.",
        });
        void refreshMovements();
        void refreshAddresses();
        return signature;
      } catch (e) {
        toast("Withdrawal failed", {
          type: "error",
          id: "withdraw",
          description: apiMessage(e, "Please try again."),
        });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [signTransaction, toast, refreshMovements, refreshAddresses]
  );

  const saveAddress = useCallback(
    async (address: string, label: string) => {
      try {
        await api.saveAddress(address, label);
        await refreshAddresses();
        toast("Address saved", { type: "success" });
      } catch (e) {
        toast("Could not save address", {
          type: "error",
          description: apiMessage(e, "Please try again."),
        });
      }
    },
    [refreshAddresses, toast]
  );

  const deleteAddress = useCallback(
    async (id: string) => {
      try {
        await api.deleteAddress(id);
        await refreshAddresses();
      } catch {
        toast("Could not remove address", { type: "error" });
      }
    },
    [refreshAddresses, toast]
  );

  return {
    busy,
    checking,
    addresses,
    movements,
    inspect,
    withdraw,
    saveAddress,
    deleteAddress,
    refreshMovements,
    refreshAddresses,
  };
}
