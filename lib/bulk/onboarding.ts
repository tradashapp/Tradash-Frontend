import { ensureKeychain } from "./keychain";
import { submitSigned } from "./client";
import { nonceNs, signatureDomain } from "@/lib/config";
import type { BulkNetwork } from "@/lib/config";
import type { OrderResponse } from "./types";

// Onboarding = the two MASTER-signed actions that make one-tap trading work:
//   1. agentWalletCreation — authorize our generated agent session key
//   2. abc — approve our builder-code recipient + fee (our revenue)
// Neither can be signed by the agent key. We use the keychain's prepare/finalize
// (external-wallet) flow: prepare → get messageBytes → Privy signs → finalize.

/** Signs raw bytes with the master wallet, returning a base58 signature. */
export type MasterSignBytes = (message: Uint8Array) => Promise<string>;

// Shared options every `prepare*` call MUST carry. Both fields fail obscurely
// when missing, so they're built in one place rather than per call site:
//
//  - nonce: the WASM calls SystemTime::now() when no nonce is given, which
//    PANICS ("time not implemented") in both the browser and Node. Always pass
//    an explicit nonce so it never touches the system clock. See `nonceNs()`
//    for why it's a nanosecond STRING and not `Date.now()`.
//  - signatureDomain: Bulk v1.0.17 binds every signature to one network. It is
//    NOT sent in the payload — the server rebuilds the preimage with its own
//    domain, so a missing/mismatched one comes back as an opaque `bad
//    signature` with nothing pointing at the domain as the cause.
const signOpts = (account: string) => ({
  account,
  nonce: nonceNs(),
  signatureDomain: signatureDomain(),
});

async function prepareSignSubmit(
  prepared: { messageBytes: Uint8Array; finalize: (sig: string) => unknown },
  signBytes: MasterSignBytes
): Promise<OrderResponse> {
  const signature = await signBytes(prepared.messageBytes);
  const signed = prepared.finalize(signature);
  return submitSigned(signed);
}

// --- Account funding (creates the Bulk account) ------------------------------
// A fresh wallet has NO Bulk account until it's funded. HOW it's funded depends
// on the network, so `fundAccount` below branches on config.bulk.network:
//   testnet → faucet (free test funds); mainnet → real USDC deposit.
// Switching networks is a one-line config change, not a code change.

/**
 * TESTNET: claim the faucet to create + fund the account (~10,000 test units,
 * once per 24h per account). Master-signed.
 */
export async function claimFaucet(
  masterAccount: string,
  signBytes: MasterSignBytes
): Promise<OrderResponse> {
  const kc = await ensureKeychain();
  const prepared = kc.prepareFaucet(signOpts(masterAccount));
  return prepareSignSubmit(prepared, signBytes);
}

/**
 * MAINNET deposit: wallet USDC -> Bulk trading collateral.
 *
 * Deposits do NOT go through Bulk's signed REST API. The `transfer` action
 * moves margin BETWEEN EXISTING BULK ACCOUNTS, so the old implementation --
 * `prepareTransfer(master, master, ...)` -- was rejected with
 * `transferFailed: "transfer source and destination must differ"`, inside an
 * HTTP 200 that nothing inspected. Real money enters the protocol by an
 * on-chain instruction to Bulk's vault program, signed by the user's WALLET.
 *
 * See `lib/solana/bulkVault.ts` for the program id, PDAs and instruction
 * layout (ported from Bulk's own client SDK and verified against mainnet).
 * This module keeps the keychain-signed Bulk actions; the vault rail lives
 * there because it is a plain Solana transaction, not a Bulk envelope.
 *
 * Kept as a re-export so callers have ONE deposit entry point rather than
 * choosing between two, and so the old name keeps working.
 */
export { buildDepositTx, buildWithdrawIntentTx } from "@/lib/solana/bulkVault";

/**
 * Withdrawals are the mirror of the deposit above and also go on-chain, as a
 * withdrawal INTENT: `buildWithdrawIntentTx` (exported above) signals the
 * request, moving no tokens itself -- Bulk observes the intent and pays out
 * from the vault. The old keychain `prepareTransfer(master, master, ...)`
 * version was broken in exactly the same way as the old deposit.
 */

/**
 * Fund + create the Bulk account for a fresh wallet, using the right method for
 * the current network. On mainnet a `depositAmount` (USDC) is required.
 */
export async function fundAccount(
  masterAccount: string,
  signBytes: MasterSignBytes,
  opts: { network: BulkNetwork; depositAmount?: number }
): Promise<OrderResponse> {
  if (opts.network === "mainnet") {
    if (!opts.depositAmount || opts.depositAmount <= 0) {
      throw new Error("A USDC deposit amount is required to fund on mainnet");
    }
    return depositCollateral(masterAccount, opts.depositAmount, signBytes);
  }
  return claimFaucet(masterAccount, signBytes);
}

/** Authorize the agent session key on the master account. */
export async function authorizeAgentWallet(
  masterAccount: string,
  agentPubkey: string,
  signBytes: MasterSignBytes
): Promise<OrderResponse> {
  const kc = await ensureKeychain();
  const prepared = kc.prepareAgentWallet(
    agentPubkey,
    false,
    signOpts(masterAccount)
  );
  return prepareSignSubmit(prepared, signBytes);
}

/** Approve our builder-code recipient + fee cap on the master account. */
export async function approveBuilderCode(
  masterAccount: string,
  recipient: string,
  feeBps: number,
  signBytes: MasterSignBytes
): Promise<OrderResponse> {
  const kc = await ensureKeychain();
  const prepared = kc.prepareApproveBuilderCode(
    recipient,
    feeBps,
    signOpts(masterAccount)
  );
  return prepareSignSubmit(prepared, signBytes);
}
