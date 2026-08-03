import { ensureKeychain } from "./keychain";
import type { Keychain } from "./keychain";
import { signatureDomain } from "@/lib/config";

// One-tap trade signing with the agent session key. The agent signs orders on
// behalf of the MASTER account (agent-wallet flow): we `prepareOrder` with
// { account: master, signer: agent }, then the agent signs the prepared bytes
// via `signPrepared`. The WASM handles wincode encoding + the envelope.

export interface AgentSigner {
  /** Agent (session key) pubkey. */
  pubkey: string;
  /** Master account the agent trades for. */
  account: string;
  /**
   * Prepare a verbose order for the master account, sign it with the agent, and
   * return the finalized envelope ready to POST. Runs in the browser (the WASM
   * prepare* path needs the browser environment).
   */
  signOrderFor(order: unknown): unknown;
}

/** Build an agent signer bound to the master account it trades for. */
export async function makeAgentSigner(
  agentSecretBase58: string,
  masterAccount: string
): Promise<AgentSigner> {
  const kc: typeof Keychain = await ensureKeychain();
  // Since keychain 0.1.21+ the signer is bound to a network at construction:
  // `fromBase58` takes the signature domain as a required 2nd argument.
  const signer = kc.WasmSigner.fromBase58(agentSecretBase58, signatureDomain());
  return {
    pubkey: signer.pubkey,
    account: masterAccount,
    signOrderFor(order: unknown) {
      // account = master (whose position), signer = agent (who signs).
      // Pass an explicit nonce — without it the WASM calls SystemTime::now()
      // which panics ("time not implemented") in the browser.
      // `signatureDomain` binds the signature to this network (Bulk v1.0.17);
      // omitting it signs the old preimage → Bulk rejects with `bad signature`.
      const prepared = kc.prepareOrder(order, {
        account: masterAccount,
        signer: signer.pubkey,
        nonce: Date.now(),
        signatureDomain: signatureDomain(),
      });
      return signer.signPrepared(prepared);
    },
  };
}

/** Generate a fresh agent keypair (base58 secret + pubkey). Stored client-side. */
export async function generateAgentKeypair(): Promise<{
  secretBase58: string;
  pubkey: string;
}> {
  const kc = await ensureKeychain();
  const kp = new kc.WasmKeypair();
  return { secretBase58: kp.toBase58(), pubkey: kp.pubkey };
}
