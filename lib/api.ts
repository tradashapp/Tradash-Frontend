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

/**
 * Supplies the caller's Privy access token.
 *
 * Set once from React-land (see `AuthTokenBridge`), because `getAccessToken`
 * lives on a Privy hook and this module is plain TypeScript with no React
 * context. Null until login, and for the endpoints that are genuinely public
 * (leaderboard, trader profiles) it stays unused.
 */
let tokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(fn: () => Promise<string | null>): void {
  tokenProvider = fn;
}

async function authHeader(): Promise<Record<string, string>> {
  if (!tokenProvider) return {};
  try {
    const token = await tokenProvider();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // A token we cannot mint is the same as no token — let the request go and
    // let the backend answer 401, rather than throwing a different error here.
    return {};
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Privy refreshes the token on its own; asking per request means we always
  // send a live one instead of caching one that expires mid-session.
  const auth = await authHeader();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...auth,
      ...(init?.headers as Record<string, string> | undefined),
    },
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

/** What the backend knows about a withdrawal recipient before funds move. */
export interface RecipientCheck {
  /** Parses as a base58 address AND sits on the ed25519 curve. */
  valid: boolean;
  onCurve: boolean;
  /** We only withdraw to addresses that already hold USDC — see the backend. */
  hasUsdcAccount: boolean;
  usdcBalance: number | null;
  /** Not in the user's address book: worth a confirmation step. */
  firstTime: boolean;
  /** Human-readable explanation when something is wrong; null when fine. */
  reason: string | null;
}

/** A gas-sponsored transfer, built and fee-payer-signed but not yet sent. */
export interface PreparedWithdrawal {
  /** base64 transaction awaiting the user's signature. */
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  /** The wallet the funds leave from (resolved server-side from the token). */
  from: string;
  feeSponsored: boolean;
}

/** A row in the money history: deposits, transfers and withdrawals. */
export interface Movement {
  id: string;
  kind: "deposit" | "transfer_in" | "transfer_out" | "withdrawal";
  amount: number;
  signature: string | null;
  recipient: string | null;
  status: "pending" | "confirmed" | "failed";
  sponsored: boolean;
  network: string;
  error: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

/** A saved withdrawal address. */
export interface SavedAddress {
  id: string;
  address: string;
  label: string;
  network: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const api = {
  /**
   * Get-or-create + sync the user by Privy DID after login.
   *
   * Outboxed: this is the write that CREATES the user row. If it's lost the
   * person can still trade (orders go to Bulk, not to us) but has no record to
   * attach those trades to, so history and the leaderboard would silently skip
   * them. Retried until it lands.
   */
  syncUser: ({ privyId, ...identity }: UserSync) =>
    enqueue(`/users/${encodeURIComponent(privyId)}`, "POST", identity),

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

  /**
   * Pick one of the generated avatars. Sends the SEED rather than the URL: the
   * backend owns the mapping from seed to image, and validates it against the
   * list it serves, so the client can't write an arbitrary URL into a field
   * every other user's browser will load as an <img src>.
   */
  selectAvatar: async (privyId: string, seed: string): Promise<string> => {
    const { avatarUrl } = await req<{ avatarUrl: string }>(
      `/users/${encodeURIComponent(privyId)}/avatar`,
      { method: "PUT", body: JSON.stringify({ seed }) }
    );
    return avatarUrl;
  },

  /** The generated avatars offered by the picker. */
  fetchAvatarChoices: (): Promise<{
    avatars: { seed: string; url: string }[];
  }> => req<{ avatars: { seed: string; url: string }[] }>(`/avatars`),

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

  // --- Money movement: external withdrawals, address book, history ---------
  //
  // All of these are authenticated: the backend takes the user from the access
  // token, which is why none of them pass a privyId.

  /** Check a recipient before the user commits an amount. */
  inspectRecipient: (address: string): Promise<RecipientCheck> =>
    req<RecipientCheck>(
      `/withdrawals/recipient/${encodeURIComponent(address)}`
    ),

  /**
   * Step 1: ask the backend to build a gas-sponsored transfer. Moves nothing —
   * the returned transaction carries only the fee payer's signature and is
   * inert until the user's wallet signs it too.
   */
  prepareWithdrawal: (to: string, amount: number): Promise<PreparedWithdrawal> =>
    req<PreparedWithdrawal>("/withdrawals/prepare", {
      method: "POST",
      body: JSON.stringify({ to, amount }),
    }),

  /** Step 2: hand back the user-signed transaction for broadcast. */
  submitWithdrawal: (
    signedTransaction: string,
    to: string,
    amount: number
  ): Promise<{ signature: string }> =>
    req<{ signature: string }>("/withdrawals/submit", {
      method: "POST",
      body: JSON.stringify({ signedTransaction, to, amount }),
    }),

  /** Deposits, wallet<->trading transfers and withdrawals, newest first. */
  fetchMovements: (limit = 50): Promise<Movement[]> =>
    req<Movement[]>(`/movements?limit=${limit}`),

  fetchAddressBook: (): Promise<SavedAddress[]> =>
    req<SavedAddress[]>("/address-book"),

  saveAddress: (address: string, label: string): Promise<SavedAddress> =>
    req<SavedAddress>("/address-book", {
      method: "POST",
      body: JSON.stringify({ address, label }),
    }),

  deleteAddress: async (id: string): Promise<void> => {
    // 204 No Content — nothing to parse, so this bypasses `req`.
    const auth = await authHeader();
    const res = await fetch(`${BASE}/address-book/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: auth,
    });
    if (!res.ok) throw new ApiError(`/address-book/${id}`, res.status);
  },

};
