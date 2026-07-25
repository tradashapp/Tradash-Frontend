import { ensureKeychain } from "./keychain";

// One-tap trade signing with the agent session key. The WasmSigner is built
// from the agent's base58 secret and signs orders locally (no wallet popup).
// `sign(order, nonce)` returns a finalized signed transaction envelope ready to
// POST to /order — the WASM handles wincode encoding + signature internally.

export interface AgentSigner {
  pubkey: string;
  /** Sign a single order/cancel action → signed envelope for /order. */
  signOrder(order: unknown, nonce?: number): unknown;
}

/** Build an agent signer from a base58 secret key (32 or 64 byte). */
export async function makeAgentSigner(
  agentSecretBase58: string
): Promise<AgentSigner> {
  const kc = await ensureKeychain();
  const signer = kc.WasmSigner.fromBase58(agentSecretBase58);
  return {
    pubkey: signer.pubkey,
    signOrder(order: unknown, nonce?: number) {
      return signer.sign(order, nonce ?? Date.now());
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
