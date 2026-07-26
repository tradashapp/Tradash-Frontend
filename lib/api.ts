import { config } from "@/lib/config";
import type { CompletedTrade } from "@/types";

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

// Backend trade row shape (from routes/trades.ts). openedAt/closedAt are ISO.
interface ApiTrade {
  symbol: string;
  direction: string;
  entryPrice: number;
  exitPrice: number;
  leverage: number;
  size: number;
  pnl: number;
  roi: number;
  durationMs: number;
  openedAt: string; // ISO
  closedAt: string; // ISO
}

function toApiTrade(t: CompletedTrade): ApiTrade {
  return {
    symbol: t.symbol,
    direction: t.direction,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    leverage: t.leverage,
    size: t.size,
    pnl: t.pnl,
    roi: t.roi,
    durationMs: t.durationMs,
    openedAt: new Date(t.openedAt).toISOString(),
    closedAt: new Date(t.closedAt).toISOString(),
  };
}

function fromApiTrade(t: ApiTrade & { id?: string }): CompletedTrade {
  return {
    id: t.id ?? `${t.closedAt}-${t.symbol}`,
    symbol: t.symbol as CompletedTrade["symbol"],
    direction: t.direction as CompletedTrade["direction"],
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    leverage: t.leverage,
    size: t.size,
    pnl: t.pnl,
    roi: t.roi,
    durationMs: t.durationMs,
    openedAt: new Date(t.openedAt).getTime(),
    closedAt: new Date(t.closedAt).getTime(),
  };
}

// Identity sync payload — keyed by the stable Privy DID so one person maps to
// one backend user across every login method.
export interface UserSync {
  privyId: string;
  walletAddress?: string | null;
  authMethod?: string | null;
  linkedAccounts?: { type: string; [k: string]: unknown }[];
  referralCode?: string | null;
}

export const api = {
  /** Get-or-create + sync the user by Privy DID after login. */
  syncUser: ({ privyId, ...identity }: UserSync) =>
    req(`/users/${encodeURIComponent(privyId)}`, {
      method: "POST",
      body: JSON.stringify(identity),
    }),

  /** Record that a master-signed onboarding step completed. */
  recordOnboard: (privyId: string, step: "agent" | "builder") =>
    req(`/users/${encodeURIComponent(privyId)}/onboard`, {
      method: "POST",
      body: JSON.stringify({ step }),
    }),

  /** Persist a completed live trade. */
  recordTrade: (privyId: string, trade: CompletedTrade) =>
    req(`/users/${encodeURIComponent(privyId)}/trades`, {
      method: "POST",
      body: JSON.stringify(toApiTrade(trade)),
    }),

  /** Fetch a user's live trade history (newest first). */
  fetchHistory: async (privyId: string): Promise<CompletedTrade[]> => {
    const rows = await req<(ApiTrade & { id?: string })[]>(
      `/users/${encodeURIComponent(privyId)}/trades`
    );
    return rows.map(fromApiTrade);
  },
};
