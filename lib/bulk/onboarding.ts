import { ensureKeychain } from "./keychain";
import { submitSigned } from "./client";
import { signatureDomain } from "@/lib/config";
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
//    an explicit ms-epoch (u64) nonce so it never touches the system clock.
//  - signatureDomain: Bulk v1.0.17 binds every signature to one network. It is
//    NOT sent in the payload — the server rebuilds the preimage with its own
//    domain, so a missing/mismatched one comes back as an opaque `bad
//    signature` with nothing pointing at the domain as the cause.
const signOpts = (account: string) => ({
  account,
  nonce: Date.now(),
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
 * MAINNET: deposit USDC collateral from the user's wallet into Bulk (external
 * transfer), which creates + funds the account. Master-signed. `amount` is a
 * plain number (USDC).
 */
export async function depositCollateral(
  masterAccount: string,
  amount: number,
  signBytes: MasterSignBytes
): Promise<OrderResponse> {
  const kc = await ensureKeychain();
  // Deposit into the user's own Bulk account (from == to == master wallet).
  const prepared = kc.prepareTransfer(
    masterAccount, // from: user's Solana wallet
    masterAccount, // to: their Bulk trading account
    amount,
    { ...signOpts(masterAccount), kind: "external", marginSymbol: "USDC" }
  );
  return prepareSignSubmit(prepared, signBytes);
}

/**
 * Withdraw USDC collateral from the user's Bulk trading account back to their
 * Solana wallet (external transfer, master-signed) — the reverse of
 * depositCollateral. Bulk bounds the withdrawable amount by
 * `min(equity − 1.05 × maintenanceMargin, marginPnl)` and rejects a transfer
 * that would push the account toward liquidation, so only free collateral can
 * leave. `amount` is a plain number (USDC).
 *
 * NOTE: mirrors depositCollateral's verified external-transfer shape
 * (from == to == master, kind "external"); the keychain resolves the wallet↔
 * account direction. If a live test shows withdraw needs distinct from/to
 * pubkeys, adjust here.
 */
export async function withdrawCollateral(
  masterAccount: string,
  amount: number,
  signBytes: MasterSignBytes
): Promise<OrderResponse> {
  const kc = await ensureKeychain();
  const prepared = kc.prepareTransfer(
    masterAccount, // from: their Bulk trading account
    masterAccount, // to: user's Solana wallet
    amount,
    { ...signOpts(masterAccount), kind: "external", marginSymbol: "USDC" }
  );
  return prepareSignSubmit(prepared, signBytes);
}

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
