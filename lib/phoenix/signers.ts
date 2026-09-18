/**
 * Signer-set assertions for Phoenix instructions.
 *
 * WHY THIS FILE EXISTS — read before changing anything here.
 *
 * Phoenix's REST API DROPS UNKNOWN FIELDS SILENTLY. `positionAuthority` is
 * camelCase while its siblings are snake_case (`num_base_lots`,
 * `traderPdaIndex` is camelCase again), so a plausible-looking typo —
 * `position_authority`, `delegate`, `trader_wallet` — is accepted with a 200
 * and simply ignored. The instruction that comes back is then signed by the
 * OWNER instead of the delegate. Verified live 2026-09-18.
 *
 * The failure mode is the dangerous kind: no error, no warning, and the bug
 * only shows up as a wallet prompt the user should never have seen, or a
 * transaction that cannot be signed because the owner's key is not to hand.
 *
 * So the signer set is CHECKED, never assumed. This is a security control: it
 * is also what guarantees the fee-payer sponsor is not induced into co-signing
 * an instruction the user did not intend.
 */

/** Solana account roles as @solana/kit encodes them (used by the Rise SDK). */
export const ROLE = {
  READONLY: 0,
  WRITABLE: 1,
  READONLY_SIGNER: 2,
  WRITABLE_SIGNER: 3,
} as const;

/** An instruction as the REST API returns it. */
export interface RestInstruction {
  programId: string;
  data: number[];
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}

/** An instruction as the Rise SDK builds it (role bitfield, not booleans). */
export interface SdkInstruction {
  programAddress: string;
  data: Uint8Array | Record<string, number>;
  accounts: { address: string; role: number }[];
}

export interface SignerSet {
  /** Signers that must also pay — the fee/rent payer slot. */
  writable: string[];
  /** Signers that only authorise — the trading-authority slot. */
  readonly: string[];
  all: string[];
}

/** Collect the signers of REST-built instructions. */
export function signersOfRest(ixs: RestInstruction[]): SignerSet {
  const writable: string[] = [];
  const readonly: string[] = [];
  for (const ix of ixs) {
    for (const k of ix.keys) {
      if (!k.isSigner) continue;
      (k.isWritable ? writable : readonly).push(k.pubkey);
    }
  }
  return { writable, readonly, all: [...writable, ...readonly] };
}

/** Collect the signers of SDK-built instructions. */
export function signersOfSdk(ixs: SdkInstruction[]): SignerSet {
  const writable: string[] = [];
  const readonly: string[] = [];
  for (const ix of ixs) {
    for (const a of ix.accounts) {
      if (a.role === ROLE.WRITABLE_SIGNER) writable.push(a.address);
      else if (a.role === ROLE.READONLY_SIGNER) readonly.push(a.address);
    }
  }
  return { writable, readonly, all: [...writable, ...readonly] };
}

export interface ExpectedSigners {
  /** The delegate (`positionAuthority`) that must authorise the trade. */
  delegate: string;
  /** The sponsor paying fees/rent, when one is used. */
  feePayer?: string;
  /**
   * The owner wallet. Passed so it can be asserted ABSENT — its presence is
   * the exact symptom of a dropped `positionAuthority`.
   */
  owner: string;
}

/**
 * Throw unless the built instructions are signed by the delegate (and sponsor),
 * with the owner nowhere in the set.
 *
 * Call this on every order before it is signed or broadcast. A silent
 * owner-signed order is the failure this prevents.
 */
export function assertDelegateSigned(
  signers: SignerSet,
  expected: ExpectedSigners
): void {
  const { delegate, feePayer, owner } = expected;

  if (signers.all.includes(owner)) {
    throw new Error(
      `Phoenix signer check failed: owner ${owner} is a required signer. ` +
        `This almost always means \`positionAuthority\` was dropped — check the ` +
        `field spelling (camelCase) — so the order would prompt the user's wallet ` +
        `instead of being signed by the delegate.`
    );
  }

  if (!signers.readonly.includes(delegate)) {
    throw new Error(
      `Phoenix signer check failed: delegate ${delegate} is not an authorising ` +
        `signer. Signers were: ${signers.all.join(", ") || "(none)"}.`
    );
  }

  if (feePayer && !signers.writable.includes(feePayer)) {
    throw new Error(
      `Phoenix signer check failed: fee payer ${feePayer} is not in the ` +
        `writable signer slot. Writable signers: ${signers.writable.join(", ") || "(none)"}.`
    );
  }
}
