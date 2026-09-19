import { PHOENIX_PROGRAM_ID } from "./config";

/**
 * Verify that a stored delegate is still the one Phoenix will accept.
 *
 * ## Why this exists
 *
 * Bulk publishes `authorizedAgentWallets` on its account read, so a revoked key
 * is caught the moment the app rehydrates and the user is sent back through
 * onboarding. Phoenix exposes no equivalent over REST or WS — neither
 * `/v1/view/trader/{pda}` nor the `traderState` stream carries the delegate —
 * so without this the app trusts localStorage optimistically and a revoked or
 * never-registered key is discovered only when an order fails.
 *
 * The delegate IS on chain: `DelegateTrader` writes `positionAuthority` into
 * the trader account itself (not into a separate `Permission` account, which
 * Phoenix uses for a different, exchange-level role). So the check is a single
 * `getAccountInfo` plus the SDK's own decoder.
 *
 * Verified [LIVE] 2026-09-19 against the real mainnet account: the trader PDA
 * decodes to `authority` = the owner wallet and `positionAuthority` = the
 * registered delegate, confirming the two are distinct fields and that the
 * registered key is readable.
 *
 * ## Why a failure here does NOT revoke anything
 *
 * This is an advisory check, and the three results are deliberately distinct:
 * `"ok"`, `"mismatch"` (the chain names a different key — re-onboarding is
 * genuinely needed) and `"unknown"` (the RPC failed or the account does not
 * exist yet). Only `"mismatch"` is evidence. Treating an RPC hiccup as a
 * revoked delegate would log users out of a working session, which is worse
 * than the optimistic behaviour this replaces — the underlying failure mode is
 * loud anyway, since an order signed by a stale delegate is rejected by the
 * chain rather than silently mis-executed.
 */

export type DelegateStatus = "ok" | "mismatch" | "unknown";

export interface DelegateCheckResult {
  status: DelegateStatus;
  /** The delegate the chain actually has, when it could be read. */
  onChain?: string;
  /** Why the status is `unknown`. Never shown as a revocation. */
  reason?: string;
}

/**
 * Read `positionAuthority` off the trader account.
 *
 * `traderPda` must be the cross subaccount's PDA, the same one account reads
 * use — the delegate is recorded per trader account, so another subaccount's
 * PDA would answer a different question.
 */
export async function readOnChainDelegate(
  traderPda: string,
  rpcUrl: string
): Promise<{ delegate?: string; reason?: string }> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: [traderPda, { encoding: "base64" }],
      }),
    });
    // Rate limiting is called out by name. It is by far the most common
    // failure here, and reporting it as anything vaguer sends the reader
    // looking for a missing account instead of a throttled endpoint — which is
    // exactly what happened on 2026-09-20.
    if (res.status === 429) {
      return { reason: "RPC rate limited (429) — could not read the account" };
    }
    if (!res.ok) return { reason: `RPC ${res.status}` };

    const body = (await res.json()) as {
      result?: { value?: { owner?: string; data?: [string, string] } };
      error?: { message?: string };
    };
    if (body.error) return { reason: body.error.message ?? "RPC error" };

    // DISTINGUISH "no result" FROM "no account". A JSON-RPC success carries a
    // `result` envelope whose `value` is null only when the account genuinely
    // does not exist. A throttling proxy can return 200 with no `result` at
    // all, and calling that "does not exist" is a false negative about on-chain
    // state — the bug this branch exists to prevent.
    if (!body.result) {
      return { reason: "RPC returned no result (likely throttled)" };
    }

    const value = body.result.value;
    // Genuinely absent: the user has never registered. Not a mismatch — there
    // is nothing to contradict.
    if (!value?.data) return { reason: "trader account does not exist" };

    // Decoding data from an account owned by another program would be reading
    // arbitrary bytes through Phoenix's layout.
    if (value.owner !== PHOENIX_PROGRAM_ID) {
      return { reason: `account owned by ${value.owner}, not Phoenix` };
    }

    const rise = await import("@ellipsis-labs/rise");
    const bytes = Uint8Array.from(atob(value.data[0]), (c) => c.charCodeAt(0));
    const trader = rise.decodeTrader(bytes) as { positionAuthority: unknown };
    const delegate = String(trader.positionAuthority);
    return delegate ? { delegate } : { reason: "no positionAuthority on account" };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Compare the stored delegate against the chain.
 *
 * Never throws: the caller uses this to decide whether to warn, and a check
 * that throws would take down the session it is meant to protect.
 */
export async function checkDelegate(
  traderPda: string,
  storedDelegate: string,
  rpcUrl: string
): Promise<DelegateCheckResult> {
  const { delegate, reason } = await readOnChainDelegate(traderPda, rpcUrl);
  if (!delegate) return { status: "unknown", reason };
  if (delegate === storedDelegate) return { status: "ok", onChain: delegate };
  return { status: "mismatch", onChain: delegate };
}
