import { PHOENIX_API } from "./config";

/**
 * Register a trader account on Phoenix.
 *
 * ## Why this is a separate step from delegate registration
 *
 * Phoenix has TWO distinct on-chain setup steps, and conflating them was a real
 * bug: a wallet that had never traded on Phoenix hit
 * `Phoenix deposit would fail: "AccountNotFound"` because `onboarding.ts`
 * registers the DELEGATE (`DelegateTrader`) but assumes the trader account
 * already exists. It does not, for a new wallet.
 *
 *   1. **Register the trader account** — creates the trader PDA. This module.
 *   2. **Register the delegate** — appoints `positionAuthority` on that PDA.
 *      `onboarding.ts`. Requires step 1 to have happened.
 *
 * Nothing created the trader PDA before this, because development used wallets
 * that had been onboarded out of band through Phoenix's own UI.
 *
 * ## The owner signs NOTHING [LIVE]
 *
 * Verified against the live route with a fresh keypair: the build returns two
 * instructions, and the owner wallet is **absent from both signer sets**. The
 * signers are the fee payer and Phoenix's own `traderOnboarder`
 * (`EzkM8YbCkB…`), which is why the flow ends at `send-register-ixs` — Phoenix
 * adds its signature server-side and broadcasts.
 *
 * So registration is a zero-prompt, fully sponsorable step. It costs the user
 * no signature and no SOL when a sponsor pays.
 *
 * ## Idempotent by design [LIVE]
 *
 * `includeRegisterTrader` reports whether registration is actually needed:
 * `true` for a fresh wallet, `false` for one already registered. Callers can
 * therefore run this unconditionally rather than probing first and racing.
 */

interface RegisterIxAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface RegisterIx {
  programId: string;
  data: number[];
  keys: RegisterIxAccountMeta[];
}

export interface BuildRegisterResult {
  instructions: RegisterIx[];
  traderPda: string;
  traderOnboarder: string;
  txFeePayer: string;
  /** False when the account already exists — nothing to do. */
  includeRegisterTrader: boolean;
}

/**
 * Ask Phoenix what it would take to register `authority`.
 *
 * `txFeePayer` may be the sponsor: the route echoes it back and places it in
 * the signer slot, so the owner never pays.
 */
export async function buildRegisterTrader(
  authority: string,
  txFeePayer: string
): Promise<BuildRegisterResult> {
  const res = await fetch(`${PHOENIX_API}/v1/exchange/build-register-ixs`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ traderAuthority: authority, txFeePayer }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Phoenix register build failed: ${res.status}${
        body ? ` — ${body.slice(0, 200)}` : ""
      }`
    );
  }
  return (await res.json()) as BuildRegisterResult;
}

/**
 * Hand the signed transaction back to Phoenix to co-sign and broadcast.
 *
 * Phoenix's `traderOnboarder` must sign one of the instructions, and only
 * Phoenix holds that key — so unlike every other flow in this app, the final
 * broadcast is theirs, not ours.
 */
export async function sendRegisterTrader(params: {
  transactionBase64: string;
  authority: string;
  txFeePayer: string;
}): Promise<{ signature: string; traderPda: string }> {
  const res = await fetch(`${PHOENIX_API}/v1/exchange/send-register-ixs`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      transaction: params.transactionBase64,
      traderAuthority: params.authority,
      txFeePayer: params.txFeePayer,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Phoenix register send failed: ${res.status}${
        body ? ` — ${body.slice(0, 200)}` : ""
      }`
    );
  }
  return (await res.json()) as { signature: string; traderPda: string };
}

/** Does this authority already have a trader account? */
export async function traderAccountExists(traderPda: string): Promise<boolean> {
  try {
    const res = await fetch(`${PHOENIX_API}/v1/view/trader/${traderPda}`, {
      headers: { accept: "application/json" },
    });
    // 404 is the documented "no trader account" answer, not an error.
    return res.ok;
  } catch {
    // A network failure is not evidence of absence. Report "exists" so the
    // caller does not try to register an account that may be fine — a
    // redundant registration is rejected, but a spurious one wastes a
    // round trip and confuses the logs.
    return true;
  }
}
