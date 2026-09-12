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
 * NOT IMPLEMENTED, and deliberately fails loudly rather than pretending.
 *
 * This used to call `prepareTransfer(master, master, ...)`. That is the wrong
 * primitive twice over. `prepareTransfer` is a MARGIN TRANSFER BETWEEN BULK
 * ACCOUNTS, so passing the same pubkey as both ends is rejected outright --
 * mainnet answers `transferFailed: "transfer source and destination must
 * differ"` inside an HTTP 200, which until now was not inspected, so the UI
 * announced a successful deposit that moved nothing.
 *
 * The real rail is a plain on-chain SPL transfer of USDC from the user's wallet
 * to Bulk's deposit vault, signed by the WALLET (Privy), not by the keychain.
 * The keychain has no deposit function at all, while it does have
 * `prepareWithdraw(amount, blockhash, user, vault, recipientTokenAccount)` --
 * that asymmetry is the tell: Bulk must sign money LEAVING its vault, but
 * anyone can send money INTO it.
 *
 * What is missing is the vault address. It is not derivable from anything we
 * hold, `/config?which=...` did not yield it on probing, and guessing an
 * address to send real USDC to is not an acceptable failure mode -- funds sent
 * to a wrong address are gone. Get the mainnet vault pubkey (and the deposit
 * flow it expects) from Bulk, then implement this as:
 *   1. resolve the user's USDC ATA and the vault's USDC ATA,
 *   2. build an SPL `transferChecked` for `amount`,
 *   3. have Privy sign + send it,
 *   4. poll `fetchAccount` until `totalMargin` reflects the credit.
 */
export async function depositCollateral(
  _masterAccount: string,
  _amount: number,
  _signBytes: MasterSignBytes
): Promise<OrderResponse> {
  throw new Error(
    "Deposits aren't live yet. Fund your account from Bulk directly for now."
  );
}

/**
 * Withdraw USDC collateral from the user's Bulk trading account back to their
 * Solana wallet (external transfer, master-signed) — the reverse of
 * depositCollateral. Bulk bounds the withdrawable amount by
 * `min(equity − 1.05 × maintenanceMargin, marginPnl)` and rejects a transfer
 * that would push the account toward liquidation, so only free collateral can
 * leave. `amount` is a plain number (USDC).
 *
 * NOT IMPLEMENTED, for the same reason as `depositCollateral` above: this was
 * built on `prepareTransfer(master, master, ...)`, which Bulk rejects with
 * `transfer source and destination must differ` -- the note here always said
 * the shape was unverified, and it is now confirmed wrong.
 *
 * The keychain's actual withdrawal primitive is
 *   prepareWithdraw(amount, blockhash, user, vault, recipientTokenAccount)
 * which needs a recent Solana blockhash, Bulk's vault pubkey, and the user's
 * USDC token account. The vault address is the same missing piece that blocks
 * deposits; the rest we can derive. Implement alongside the deposit rail.
 */
export async function withdrawCollateral(
  _masterAccount: string,
  _amount: number,
  _signBytes: MasterSignBytes
): Promise<OrderResponse> {
  throw new Error(
    "Withdrawals aren't live yet. Withdraw from Bulk directly for now."
  );
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
