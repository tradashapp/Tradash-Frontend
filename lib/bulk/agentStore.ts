// Local storage of the agent session key, keyed by master wallet address.
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

export function loadAgent(walletAddress: string): StoredAgent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + walletAddress);
    return raw ? (JSON.parse(raw) as StoredAgent) : null;
  } catch {
    return null;
  }
}

export function saveAgent(walletAddress: string, agent: StoredAgent) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + walletAddress, JSON.stringify(agent));
  } catch {
    /* storage disabled — non-fatal */
  }
}

export function clearAgent(walletAddress: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(PREFIX + walletAddress);
}
