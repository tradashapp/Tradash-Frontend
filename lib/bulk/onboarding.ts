import { ensureKeychain } from "./keychain";
import { submitSigned } from "./client";
import type { OrderResponse } from "./types";

// Onboarding = the two MASTER-signed actions that make one-tap trading work:
//   1. agentWalletCreation — authorize our generated agent session key
//   2. abc — approve our builder-code recipient + fee (our revenue)
// Neither can be signed by the agent key. We use the keychain's prepare/finalize
// (external-wallet) flow: prepare → get messageBytes → Privy signs → finalize.

/** Signs raw bytes with the master wallet, returning a base58 signature. */
export type MasterSignBytes = (message: Uint8Array) => Promise<string>;

async function prepareSignSubmit(
  prepared: { messageBytes: Uint8Array; finalize: (sig: string) => unknown },
  signBytes: MasterSignBytes
): Promise<OrderResponse> {
  const signature = await signBytes(prepared.messageBytes);
  const signed = prepared.finalize(signature);
  return submitSigned(signed);
}

/** Authorize the agent session key on the master account. */
export async function authorizeAgentWallet(
  masterAccount: string,
  agentPubkey: string,
  signBytes: MasterSignBytes
): Promise<OrderResponse> {
  const kc = await ensureKeychain();
  const prepared = kc.prepareAgentWallet(agentPubkey, false, {
    account: masterAccount,
  });
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
  const prepared = kc.prepareApproveBuilderCode(recipient, feeBps, {
    account: masterAccount,
  });
  return prepareSignSubmit(prepared, signBytes);
}
