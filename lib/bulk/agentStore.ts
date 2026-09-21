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

/**
 * Load this wallet's agent key, MIGRATING a pre-network-scoping one.
 *
 * Scoping the key renamed the slot, which silently orphaned every agent stored
 * before it: `loadAgent` looked under `<prefix><network>:<wallet>`, found
 * nothing, and the app concluded there was no agent — for a browser that held a
 * perfectly good, already-authorized key at `<prefix><wallet>`. Onboarding then
 * issued ANOTHER key, which is how an account accumulates authorized agents
 * that no browser can use.
 *
 * A rename needs a migration, so this does one: read the legacy slot when the
 * scoped one is empty, and re-save it under the scoped key (keeping the legacy
 * copy, so rolling this build back doesn't strand the key again).
 *
 * The legacy key is adopted for WHATEVER network is configured now. That is the
 * pragmatic choice: which network it was authorized on is unknowable from the
 * blob, and the caller verifies it against the live account anyway — an
 * unauthorized key is rejected there rather than trusted here.
 */
export function loadAgent(walletAddress: string): StoredAgent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(walletAddress));
    if (raw) return JSON.parse(raw) as StoredAgent;

    const legacy = window.localStorage.getItem(PREFIX + walletAddress);
    if (!legacy) return null;
    const parsed = JSON.parse(legacy) as StoredAgent;
    if (!parsed?.secretBase58) return null;
    try {
      window.localStorage.setItem(key(walletAddress), legacy);
    } catch {
      /* migration is best-effort; the key still works this session */
    }
    return parsed;
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
