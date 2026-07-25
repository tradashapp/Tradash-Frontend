import { config } from "@/lib/config";

// Thin client for our own backend (users, onboarding record, trades, stats).
const BASE = config.apiUrl;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`API ${path} ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  /** Ensure the user row exists (called after Privy connect). */
  ensureUser: (wallet: string) =>
    req(`/users/${wallet}`, { method: "POST" }),

  /** Record that a master-signed onboarding step completed. */
  recordOnboard: (wallet: string, step: "agent" | "builder") =>
    req(`/users/${wallet}/onboard`, {
      method: "POST",
      body: JSON.stringify({ step }),
    }),
};
