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
 * An agent is authorized on ONE network, but the key used to be
 * `<prefix><wallet>` with no network in it. Switching
 * NEXT_PUBLIC_BULK_NETWORK therefore had the two networks OVERWRITE each
 * other's agent: onboarding on mainnet replaced the testnet secret in place,
 * and vice versa. Scoping gives each network its own slot, so switching back
 * finds the original still authorized instead of a secret that was clobbered.
 *
 * NOTE this is a correctness fix for switching, not the cause of every
 * `bad signature` — that error is about the secret not matching the pubkey the
 * account authorized. See `isBadSignatureError` in ./orders.ts for what the
 * server actually distinguishes, and the rehydrate guard in
 * hooks/useAgentWallet.ts for the check that catches it.
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
