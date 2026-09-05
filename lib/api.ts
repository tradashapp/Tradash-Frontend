import { config } from "@/lib/config";
import { enqueue, setOutboxSender } from "@/lib/outbox";
import type {
  CompletedTrade,
  Leaderboard,
  LeaderboardMetric,
  LeaderboardPeriod,
  TradeEpisode,
  TraderProfile,
} from "@/types";

// Thin client for our own backend (users, onboarding record, trades, stats).
const BASE = config.apiUrl;

/**
 * An API failure that carries the HTTP status, so callers can tell a permanent
 * rejection (4xx — the server understood and refused) from a transient one
 * (5xx / offline). The outbox needs that distinction to know what to retry.
 */
export class ApiError extends Error {
  status: number;
  constructor(path: string, status: number) {
    super(`API ${path} ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  // `status: 0` marks a network-level failure (offline, DNS, CORS) — the outbox
  // treats it as retryable, unlike a real 4xx.
  if (!res.ok) throw new ApiError(path, res.status);
  return (await res.json()) as T;
}

// Writes queued by the outbox are replayed through the same fetch path, so a
// retry is byte-identical to the original attempt.
setOutboxSender(async (item) => {
  await req(item.path, {
    method: item.method,
    body: JSON.stringify(item.body),
  });
});

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
  episodeId?: string;
}

// Backend episode shape. Timestamps are ISO on the wire, ms epoch in the store.
interface ApiEpisode {
  id: string;
  symbol: string;
  direction: string;
  openedAt: string;
  closedAt: string;
  entryLine: number;
  liqLine?: number | null;
  path: TradeEpisode["path"];
  gaps: TradeEpisode["gaps"];
  coverage: number;
}

function toApiEpisode(e: TradeEpisode): ApiEpisode {
  return {
    id: e.id,
    symbol: e.symbol,
    direction: e.direction,
    openedAt: new Date(e.openedAt).toISOString(),
    closedAt: new Date(e.closedAt ?? e.openedAt).toISOString(),
    entryLine: e.entryLine,
    liqLine: e.liqLine ?? null,
    path: e.path,
    gaps: e.gaps,
    coverage: e.coverage,
  };
}

function fromApiEpisode(e: ApiEpisode): TradeEpisode {
  return {
    id: e.id,
    // The backend only ever stores live episodes.
    mode: "live",
    symbol: e.symbol as TradeEpisode["symbol"],
    direction: e.direction as TradeEpisode["direction"],
    openedAt: new Date(e.openedAt).getTime(),
    closedAt: new Date(e.closedAt).getTime(),
    entryLine: e.entryLine,
    liqLine: e.liqLine ?? undefined,
    path: e.path,
    gaps: e.gaps ?? [],
    coverage: e.coverage,
  };
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
    episodeId: t.episodeId,
  };
}

function fromApiTrade(t: ApiTrade & { id?: string }): CompletedTrade {
  return {
    id: t.id ?? `${t.closedAt}-${t.symbol}`,
    // Backend only ever stores live trades.
    mode: "live",
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
    episodeId: t.episodeId,
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
  /** Seeds an EMPTY handle only — the backend never overwrites a chosen one. */
  username?: string | null;
}

/** The public profile fields the backend stores on the user row. */
export interface ApiUserProfile {
  username: string | null;
  avatarUrl: string | null;
}

/** Raw trade rows come back with ISO timestamps; the UI wants ms epoch. */
interface ApiTraderProfile extends Omit<TraderProfile, "recentTrades"> {
  recentTrades: (ApiTrade & { id?: string })[];
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
    enqueue(`/users/${encodeURIComponent(privyId)}/onboard`, "POST", { step }),

  /**
   * Persist a completed live trade.
   *
   * Queued through the outbox rather than fired and forgotten: the trade already
   * happened on Bulk, so losing our copy because the API blipped would drop it
   * from history, stats and the leaderboard permanently. Resolves true if it
   * landed now, false if it was queued for retry — either way it is not lost.
   */
  recordTrade: (privyId: string, trade: CompletedTrade) =>
    enqueue(
      `/users/${encodeURIComponent(privyId)}/trades`,
      "POST",
      toApiTrade(trade)
    ),

  /**
   * Upload a recorded price path. Posted separately from the trade row because
   * ONE episode backs several rows (open/add/reduce/close) — sending it per row
   * would store the same samples up to four times.
   */
  recordEpisode: (privyId: string, episode: TradeEpisode) =>
    enqueue(
      `/users/${encodeURIComponent(privyId)}/episodes`,
      "POST",
      toApiEpisode(episode)
    ),

  /** Fetch a user's recorded episodes (newest first). */
  fetchEpisodes: async (privyId: string): Promise<TradeEpisode[]> => {
    const rows = await req<ApiEpisode[]>(
      `/users/${encodeURIComponent(privyId)}/episodes`
    );
    return rows.map(fromApiEpisode);
  },

  /**
   * Claim a public handle. Resolves false when it's already taken (409) rather
   * than throwing — a taken name is an expected outcome, not a failure.
   */
  claimUsername: async (privyId: string, username: string): Promise<boolean> => {
    const res = await fetch(
      `${BASE}/users/${encodeURIComponent(privyId)}/username`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      }
    );
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`API username ${res.status}`);
    return true;
  },

  /** Upload a profile photo (base64 data URL) and get back its public URL. */
  uploadAvatar: async (privyId: string, dataUrl: string): Promise<string> => {
    const { avatarUrl } = await req<{ avatarUrl: string }>(
      `/users/${encodeURIComponent(privyId)}/avatar`,
      { method: "PUT", body: JSON.stringify({ avatar: dataUrl }) }
    );
    return avatarUrl;
  },

  /**
   * Adopt a photo hosted elsewhere — the X profile picture Privy returns after
   * a link. The backend fetches and re-hosts it: X's CDN sends no CORS header,
   * so the browser can display that image but can't read it into a data URL for
   * the upload route above.
   */
  importAvatar: async (privyId: string, remoteUrl: string): Promise<string> => {
    const { avatarUrl } = await req<{ avatarUrl: string }>(
      `/users/${encodeURIComponent(privyId)}/avatar`,
      { method: "PUT", body: JSON.stringify({ avatarUrl: remoteUrl }) }
    );
    return avatarUrl;
  },

  /** The stored profile (handle + avatar URL) for a user. */
  fetchProfile: async (privyId: string): Promise<ApiUserProfile> => {
    const user = await req<ApiUserProfile>(
      `/users/${encodeURIComponent(privyId)}`
    );
    return { username: user.username, avatarUrl: user.avatarUrl };
  },

  /**
   * Standings for a metric + period, with the signed-in user's own rank. The
   * board is public, so `privyId` is optional.
   */
  fetchLeaderboard: (
    metric: LeaderboardMetric,
    period: LeaderboardPeriod,
    privyId?: string | null
  ): Promise<Leaderboard> => {
    const q = new URLSearchParams({ metric, period });
    if (privyId) q.set("privyId", privyId);
    return req<Leaderboard>(`/leaderboard?${q.toString()}`);
  },

  /** Public profile behind a leaderboard row, scoped to the same window. */
  fetchTrader: async (
    userId: string,
    period: LeaderboardPeriod
  ): Promise<TraderProfile> => {
    const p = await req<ApiTraderProfile>(
      `/traders/${encodeURIComponent(userId)}?period=${period}`
    );
    return { ...p, recentTrades: p.recentTrades.map(fromApiTrade) };
  },

  /** Fetch a user's live trade history (newest first). */
  fetchHistory: async (privyId: string): Promise<CompletedTrade[]> => {
    const rows = await req<(ApiTrade & { id?: string })[]>(
      `/users/${encodeURIComponent(privyId)}/trades`
    );
    return rows.map(fromApiTrade);
  },
};
