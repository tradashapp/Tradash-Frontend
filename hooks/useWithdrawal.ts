"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Connection, Transaction } from "@solana/web3.js";
import { useSignTransaction } from "@privy-io/react-auth/solana";
import { api, ApiError } from "@/lib/api";
import { looksLikeAddress } from "@/lib/api";
import type { Movement, RecipientLookup, SavedAddress } from "@/lib/api";
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

/**
 * A UUID for the idempotency key.
 *
 * `crypto.randomUUID` needs a secure context, which localhost and https both
 * provide — the fallback covers an http preview host, where it is undefined.
 */
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

/** Human-readable message for an API failure. */
function apiMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 429) return "Daily withdrawal limit reached. Try tomorrow.";
    if (e.status === 503) return "Withdrawals are temporarily unavailable.";
    if (e.status === 401) return "Please sign in again.";
    if (e.status === 400) return "Not a valid Solana address.";
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

  /**
   * Ask the backend to look for USDC that arrived from outside, then refresh.
   *
   * Deposits are discovered by scanning the chain rather than reported by
   * whoever sent them, so nothing records one until someone looks. Returns
   * how many new rows were found, which lets a caller poll until a deposit
   * shows up instead of guessing at a delay.
   */
  const scanDeposits = useCallback(async (): Promise<number> => {
    try {
      const { found } = await api.scanDeposits();
      if (found > 0) await refreshMovements();
      return found;
    } catch {
      // Best-effort: the history read scans too, so a failure here only means
      // the deposit surfaces a little later.
      return 0;
    }
  }, [refreshMovements]);

  useEffect(() => {
    void refreshAddresses();
  }, [refreshAddresses]);

  /**
   * Validate a recipient. Debounced by the caller — this hits the chain to see
   * whether the address has a USDC account, so it should not run per keystroke.
   *
   * Returns a tagged result rather than null-on-failure. The panel gates the
   * send button on this, so "the lookup broke" has to be distinguishable from
   * "the address is bad" — otherwise the button just goes dead with no reason
   * shown anywhere.
   */
  const inspect = useCallback(
    async (address: string): Promise<RecipientLookup | null> => {
      const trimmed = address.trim();
      if (!trimmed) return null;
      // A half-typed address would earn a 400 from the backend's schema, whose
      // body carries no usable message. Answer locally instead of round-tripping.
      if (!looksLikeAddress(trimmed)) {
        return {
          status: "error",
          message: "Not a valid Solana address.",
        };
      }
      setChecking(true);
      try {
        return { status: "ok", check: await api.inspectRecipient(trimmed) };
      } catch (e) {
        return {
          status: "error",
          message: apiMessage(e, "Could not verify this address. Try again."),
        };
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

      // One key for this whole attempt, minted before the first network call so
      // every retry inside it carries the same value.
      const key = uuid();

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
        //
        // The key is minted ONCE per attempt and reused if this call is retried,
        // which is the whole point: a key regenerated per try would defeat the
        // protection, since the backend would see each retry as a new transfer.
        const { signature } = await api.submitWithdrawal(
          btoa(binary),
          to,
          amount,
          key
        );

        toast(`Sent ${fmtUsd(amount)}`, {
          type: "success",
          id: "withdraw",
          description: `${fmtUsd(amount)} is on its way to ${to.slice(0, 4)}…${to.slice(-4)}.`,
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

  /**
   * Memoised because consumers put this object in effect dependency arrays.
   *
   * A fresh literal every render made any such effect re-run on every state
   * change — including the `checking` flag this hook sets itself. In the
   * withdraw panel that reset the debounce timer mid-flight, so the recipient
   * lookup was rescheduled instead of firing and could be starved indefinitely.
   */
  return useMemo(
    () => ({
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
      scanDeposits,
    }),
    [
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
      scanDeposits,
    ]
  );
}
