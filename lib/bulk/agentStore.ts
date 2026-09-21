import { config } from "@/lib/config";

// Local storage of the agent session key, keyed by master wallet address AND
// Bulk network (see `key()` — an agent authorized on testnet is meaningless on
// mainnet, and reusing one across a switch fails as `bad signature`).
//
// SECURITY NOTE: for MVP the agent secret lives in localStorage so one-tap
// trading works without a server round-trip. The agent key can only place
// trades on the account (it cannot withdraw), and it's revocable via `rbc`/agent
// removal — but it is still a bearer secret in the browser. The backend already
// supports encrypted custody (PUT /users/:wallet/agent-key); moving the key
// server-side with per-session retrieval is the planned hardening.

const PREFIX = "tradash.agent.v1:";

export interface StoredAgent {
  pubkey: string;
  secretBase58: string;
}

/**
 * Storage key for a wallet's agent key — scoped to the BULK NETWORK.
 *
 * An agent wallet is authorized on ONE network. The key used to be
 * `<prefix><wallet>` with no network in it, so switching
 * NEXT_PUBLIC_BULK_NETWORK (testnet → mainnet) reused a key the new network
 * had never seen. Signatures then carried the new network's domain byte
 * against a key registered under the old one, and Bulk answered with an opaque
 * `bad signature` — a message that points at neither the key nor the network.
 *
 * Scoping the key means each network gets its own agent, and switching back
 * finds the original still authorized rather than having overwritten it.
 */
function key(walletAddress: string) {
  return `${PREFIX}${config.bulk.network}:${walletAddress}`;
}

export function loadAgent(walletAddress: string): StoredAgent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(walletAddress));
    return raw ? (JSON.parse(raw) as StoredAgent) : null;
  } catch {
    return null;
  }
}

export function saveAgent(walletAddress: string, agent: StoredAgent) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(walletAddress), JSON.stringify(agent));
  } catch {
    /* storage disabled — non-fatal */
  }
}

export function clearAgent(walletAddress: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(walletAddress));
  // Also drop any pre-network-scoping key for this wallet, so "disconnect and
  // start over" cannot leave an unreachable agent behind that a later build
  // (or a rollback) would pick up again.
  try {
    window.localStorage.removeItem(PREFIX + walletAddress);
  } catch {
    /* non-fatal */
  }
}
