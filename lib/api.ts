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
  takeProfit?: number | null;
  stopLoss?: number | null;
}

// Server-set fields that come back on reads only; the client never posts them.
interface ApiTradeRead extends ApiTrade {
  id?: string;
  source?: "live" | "bulk";
  fees?: number | null;
  funding?: number | null;
  liquidated?: boolean;
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
    takeProfit: t.takeProfit ?? null,
    stopLoss: t.stopLoss ?? null,
  };
}

function fromApiTrade(t: ApiTradeRead): CompletedTrade {
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
    source: t.source,
    fees: t.fees,
    funding: t.funding,
    liquidated: t.liquidated,
    takeProfit: t.takeProfit ?? null,
    stopLoss: t.stopLoss ?? null,
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
  recentTrades: ApiTradeRead[];
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

/**
 * A base58 Solana address is 32-44 characters. Checked client-side so a
 * half-typed address never reaches the backend, whose schema rejects anything
 * shorter with a 400 that carries no usable message.
 */
export const looksLikeAddress = (a: string): boolean =>
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.trim());

/**
 * The outcome of a recipient lookup.
 *
 * A failed lookup is NOT the same as an invalid address, and the UI must be
 * able to tell them apart: an invalid address is the user's to fix, a failed
 * lookup is ours. Collapsing both into null is what left the send button
 * disabled with nothing on screen to explain it.
 */
export type RecipientLookup =
  | { status: "ok"; check: RecipientCheck }
  | { status: "error"; message: string };

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

/**
 * The user's Tradash builder-fee arrangement, decided by the backend. Only the
 * builder fee — Bulk's venue fee is set by Bulk and never appears here.
 */
export interface FeeArrangement {
  recipient: string | null;
  capFeeBps: number;
  defaultFeeBps: number;
  /** What this user's opening orders carry (0 = no builder fee). */
  effectiveFeeBps: number;
  source: "default" | "code";
  code: string | null;
  assignedAt: string | null;
  expiresAt: string | null;
}

/**
 * The user's referral section. Percentages are of the Tradash builder fee
 * (never Bulk's exchange fee) and are set by the backend, not the client.
 */
export interface ReferralSummary {
  enabled: boolean;
  rebatePct: number;
  rewardPct: number;
  /** The standard Tradash fee the percentages apply to. */
  builderFeeBps: number;
  code: string | null;
  codeActive: boolean;
  referredBy: { username: string | null; avatarUrl: string | null } | null;
  canApplyCode: boolean;
  stats: {
    referrals: number;
    activeReferrals: number;
    volume: number;
    earned: number;
    saved: number;
  };
  referees: {
    username: string | null;
    avatarUrl: string | null;
    joinedAt: string;
    volume: number;
    earned: number;
    active: boolean;
  }[];
}

/** Who a shared code belongs to. */
/**
 * A gated feature as the backend resolves it for this user (the Grid bot).
 * `allowed` is what matters; the backend enforces it on every grid route, so
 * this only decides what the menu shows.
 */
export interface FeatureView {
  visibility: "private" | "public";
  access: "none" | "pending" | "approved" | "rejected" | "revoked";
  allowed: boolean;
  /** Show the one-tap "Apply for Grid Beta" row. */
  canApply: boolean;
  appliedAt: string | null;
  botsHalted: boolean;
}

// --- Signals (backend routes/signals.ts) -----------------------------------------
export type SignalPresetId = "trend_pullback" | "momentum_cross" | "breakout" | "mean_reversion";
export type SignalTimeframe = "15m" | "1h" | "4h";
export type SignalVerdict = "confirmed" | "caution" | "rejected" | "veto";

export type SignalExitPlanId = "scale_out" | "target_1_5" | "target_2" | "target_3";

export interface SignalPlanStat {
  trades: number;
  winRate: number;
  /** Average result per trade in R (1R = the stop distance), fees included. */
  avgR: number;
  profitFactor: number;
  maxDrawdownR: number;
}

/** Per timeframe: history length + { train, test } per exit plan. TEST is out of sample. */
export type SignalTimeframeStats = { days: number } & Partial<Record<SignalExitPlanId, { train: SignalPlanStat; test: SignalPlanStat }>>;

export interface SignalPreset {
  id: SignalPresetId;
  label: string;
  counterTrend: boolean;
  stopAtr: number;
  /** Timeframes that held up out of sample; the rest are experimental. */
  validated: SignalTimeframe[];
  params: Record<string, { default: number; min: number; max: number; label: string }>;
  risk: { stopAtr: number; rr: number };
  stats: Partial<Record<SignalTimeframe, SignalTimeframeStats>>;
}

export interface SignalPresets {
  network: "testnet" | "mainnet";
  /** Bulk symbols, e.g. "BTC-USD". */
  markets: string[];
  timeframes: SignalTimeframe[];
  maxAlerts: number;
  backtest: { generatedAt: string; markets: string[]; costBpsPerSide: number; note: string };
  exitPlans: Array<{ id: SignalExitPlanId; label: string }>;
  presets: SignalPreset[];
}

export interface SignalSettings {
  riskPct: number;
  exitPlan: SignalExitPlanId;
}

export interface SignalTrackStat {
  signals: number;
  wins: number;
  winRate: number;
  avgR: number;
  last: Array<{ r: number; outcome: string; closedAt: string; symbol: string; direction: string }>;
}

export interface SignalTrack {
  since: string;
  /** Keyed "preset|timeframe". */
  global: Record<string, SignalTrackStat>;
  /** Keyed by alert id. */
  alerts: Record<string, SignalTrackStat>;
}

export interface SignalAlert {
  id: string;
  symbol: string;
  preset: SignalPresetId;
  timeframe: SignalTimeframe;
  params: Record<string, number>;
  notifyMin: "confirmed" | "caution";
  exitPlan: SignalExitPlanId;
  validated: boolean;
  active: boolean;
  createdAt: string;
  lastSignalAt: string | null;
}

export interface SignalFactor {
  key: string;
  label: string;
  /** −1…+1 relative to the trade (+ supports it). */
  score: number;
  weight: number;
  detail: string;
}

export interface SignalView {
  id: string;
  alertId: string;
  symbol: string;
  preset: SignalPresetId;
  presetLabel: string;
  timeframe: SignalTimeframe;
  direction: "long" | "short";
  price: number;
  stop: number;
  target: number;
  atr: number;
  strength: number;
  reason: string;
  verdict: SignalVerdict;
  score: number;
  factors: SignalFactor[];
  vetoReason: string | null;
  status: "quiet" | "notified" | "taken";
  candleTime: string;
  createdAt: string;
  expiresAt: string;
  mark: number | null;
  exitPlan: SignalExitPlanId;
  /** First take-profit (1R). */
  tp1: number | null;
  validated: boolean;
  /** Paper-tracked result: target | stop | breakeven | trail | timeout. */
  outcome: string | null;
  outcomeR: number | null;
  tp1At: string | null;
  closedAt: string | null;
  /** Past its window, chased more than 0.5 ATR, or already through its stop. */
  expired: boolean;
}

// --- Notifications (backend routes/notifications.ts) -----------------------------
export type NotificationCategory =
  | "signal_alert"
  | "auto_trade"
  | "bot_risk"
  | "grid"
  | "funds"
  | "price_alert"
  | "system";
export type NotificationChannel = "webpush" | "expo" | "telegram" | "email";

export interface NotificationItem {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  /** `url` = in-app path the notification opens. */
  data: { url?: string; [k: string]: unknown };
  createdAt: string;
  read: boolean;
}

export interface NotificationSettings {
  channels: {
    webpush: { available: boolean; publicKey: string | null; devices: Array<{ id: string; createdAt: string }> };
    expo: { available: boolean; devices: Array<{ id: string; createdAt: string; platform: string | null }> };
    telegram: { available: boolean; chats: Array<{ id: string; username: string | null; mutedUntil: string | null }> };
    /** `address` is masked. */
    email: { available: boolean; address: string | null };
  };
  categories: Array<{
    key: NotificationCategory;
    label: string;
    /** Email is only ever sent for important events in these categories. */
    emailAllowed: boolean;
    enabled: Record<NotificationChannel, boolean>;
  }>;
}

// --- Grid bot (backend routes/grid.ts) ------------------------------------------
export type GridBotStatus = "starting" | "running" | "stopping" | "stopped" | "error";

export interface GridBotView {
  id: string;
  symbol: string;
  network: "testnet" | "mainnet";
  status: GridBotStatus;
  capital: number;
  createdAt: string;
  startedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  lastError: string | null;
  range: {
    lower: number;
    upper: number;
    levels: number;
    qty: number | null;
    stopLower: number | null;
    stopUpper: number | null;
  };
  mark: number | null;
  metrics: {
    equity: number | null;
    startEquity: number | null;
    netPnl: number | null;
    unrealizedPnl: number | null;
    /** Cashflows as Bulk reports them: negative = paid. */
    fees: number | null;
    funding: number | null;
    maxDrawdown: number;
    maxDrawdownPct: number;
    position: number;
    exposure: number | null;
    openOrders: number | null;
  };
  equityCurve: Array<{ at: string; equity: number }>;
  events: Array<{ at: string; level: "info" | "warn" | "error"; kind: string; message: string | null }>;
  /** This bot's fills on its sub-account (null until it has started). */
  trades: {
    fills: number;
    makerFills: number;
    volume: number;
    /** Fills that reduced the position — one completed grid step each. */
    closes: number;
    realizedPnl: number;
    fees: number;
    /** Newest first, up to 50. */
    trades: Array<{
      at: string;
      side: "buy" | "sell";
      price: number;
      size: number;
      value: number;
      maker: boolean;
      fee: number;
      realized: number;
      position: number;
      liquidation: boolean;
    }>;
  } | null;
}

export interface GridStatus {
  network: "testnet" | "mainnet";
  enabled: boolean;
  halted: boolean;
  markets: string[];
  maxCapital: number;
  key: { pubkey: string; authorized: boolean } | null;
  /** Transferable trading balance on the grid's network. */
  balance: number | null;
  active: GridBotView | null;
  recent: GridBotView[];
}

export interface GridPreviewInput {
  symbol: string;
  capital: number;
  range?: { lower: number; upper: number; intervals: number } | null;
}

export interface GridPreviewResult {
  network: "testnet" | "mainnet";
  price: number;
  params: { lower: number; upper: number; intervals: number; spacing: string };
  balance: number;
  preview: {
    ok: boolean;
    errors: string[];
    warnings: string[];
    plan: { levels: number[]; qty: number; g0: number; stopLower: number; stopUpper: number } | null;
    minCapital: number;
    minOrderNotional: number;
    spacingPctMin: number;
    roundTripCostPct: number;
    profitPerCycle: number;
    profitPerCyclePct: number;
    worstLossDown: number;
    worstLossUp: number;
    effectiveLeverage: number;
    liqLong: number | null;
    liqShort: number | null;
    fundingPerDayAtMax: number;
  };
}

/** POST that rejects with the server's human-readable message. */
async function send<T>(path: string, body: unknown = {}): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message ?? `Request failed (${res.status})`);
  return json as T;
}

export type ReferralLookup =
  | { valid: false }
  | { valid: true; code: string; username: string | null; avatarUrl: string | null; rebatePct: number };

/** A failed order, reported so the admin Operations page can see it. */
export interface OrderFailureReport {
  symbol?: string | null;
  side?: "long" | "short" | null;
  orderType?: string | null;
  /** Coarse class: rejected, bad_signature, builder_not_approved, timeout, error. */
  reason: string;
  message?: string | null;
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
    // Bypasses `req` to read the 409 status, so it must attach auth itself.
    const auth = await authHeader();
    const res = await fetch(
      `${BASE}/users/${encodeURIComponent(privyId)}/username`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...auth },
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
    const rows = await req<ApiTradeRead[]>(
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

  /**
   * Step 2: hand back the user-signed transaction for broadcast.
   *
   * `idempotencyKey` is what makes a retry safe. If the response is lost after
   * the broadcast succeeded, resending with the SAME key returns the original
   * signature instead of transferring a second time.
   */
  submitWithdrawal: (
    signedTransaction: string,
    to: string,
    amount: number,
    idempotencyKey: string
  ): Promise<{ signature: string; replayed?: boolean }> =>
    req<{ signature: string; replayed?: boolean }>("/withdrawals/submit", {
      method: "POST",
      body: JSON.stringify({ signedTransaction, to, amount, idempotencyKey }),
    }),

  /**
   * Step 1 of a sponsored collateral transfer. Note there is no recipient: the
   * destination is Bulk's vault, derived server-side.
   */
  prepareTransfer: (
    amount: number,
    direction: "deposit" | "withdraw"
  ): Promise<PreparedWithdrawal> =>
    req<PreparedWithdrawal>("/transfers/prepare", {
      method: "POST",
      body: JSON.stringify({ amount, direction }),
    }),

  /** Step 2: hand back the user-signed collateral transfer for broadcast. */
  submitTransfer: (
    signedTransaction: string,
    amount: number,
    direction: "deposit" | "withdraw",
    idempotencyKey: string
  ): Promise<{ signature: string; replayed?: boolean }> =>
    req<{ signature: string; replayed?: boolean }>("/transfers/submit", {
      method: "POST",
      body: JSON.stringify({
        signedTransaction,
        amount,
        direction,
        idempotencyKey,
      }),
    }),

  /** Deposits, wallet<->trading transfers and withdrawals, newest first. */
  fetchMovements: (limit = 50): Promise<Movement[]> =>
    req<Movement[]>(`/movements?limit=${limit}`),

  /**
   * Force a scan of the in-app wallet for USDC that arrived from outside.
   *
   * Deposits are found by reading the chain, not by a call at the time they
   * happen, so this is how the UI asks "has it landed yet?" right after a
   * user sends funds instead of waiting for the next history read.
   */
  scanDeposits: (): Promise<{ found: number; movements: Movement[] }> =>
    req<{ found: number; movements: Movement[] }>("/movements/scan", {
      method: "POST",
    }),

  /** The builder fee this user's orders must carry. Never cached by the browser. */
  feeArrangement: (privyId: string): Promise<FeeArrangement> =>
    req<FeeArrangement>(`/users/${encodeURIComponent(privyId)}/fee-arrangement`),

  /**
   * Redeem a fee code. Resolves to the new arrangement, or rejects with the
   * server's human-readable reason (invalid code, already holding one…).
   */
  redeemFeeCode: async (privyId: string, code: string): Promise<FeeArrangement> => {
    const auth = await authHeader();
    const res = await fetch(`${BASE}/users/${encodeURIComponent(privyId)}/fee-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ code }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? `Couldn't apply the code (${res.status})`);
    return body as FeeArrangement;
  },

  fetchReferral: (privyId: string): Promise<ReferralSummary> =>
    req<ReferralSummary>(`/users/${encodeURIComponent(privyId)}/referral`),

  /** Enter a referral code. Rejects with the server's human-readable reason. */
  applyReferralCode: async (privyId: string, code: string): Promise<ReferralSummary> => {
    const auth = await authHeader();
    const res = await fetch(`${BASE}/users/${encodeURIComponent(privyId)}/referral`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify({ code }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? `Couldn't apply the code (${res.status})`);
    return body as ReferralSummary;
  },

  fetchFeatures: (privyId: string): Promise<{ gridBot: FeatureView; signalBot?: FeatureView | null }> =>
    req<{ gridBot: FeatureView; signalBot?: FeatureView | null }>(`/users/${encodeURIComponent(privyId)}/features`),
  applySignalBeta: (privyId: string): Promise<{ signalBot: FeatureView }> =>
    send<{ signalBot: FeatureView }>(`/users/${encodeURIComponent(privyId)}/features/signal-bot/apply`),

  /** One-tap beta application. Idempotent: re-applying returns the same state. */
  applyGridBeta: (privyId: string): Promise<{ gridBot: FeatureView }> =>
    req<{ gridBot: FeatureView }>(`/users/${encodeURIComponent(privyId)}/features/grid-bot/apply`, {
      method: "POST",
      body: "{}",
    }),

  gridStatus: (privyId: string): Promise<GridStatus> =>
    req<GridStatus>(`/users/${encodeURIComponent(privyId)}/grid`),
  gridIssueKey: (privyId: string) =>
    send<{ pubkey: string; authorized: boolean }>(`/users/${encodeURIComponent(privyId)}/grid/key`),
  gridConfirmKey: (privyId: string) =>
    send<{ pubkey: string; authorized: boolean }>(`/users/${encodeURIComponent(privyId)}/grid/key/confirm`),
  gridPreview: (privyId: string, input: GridPreviewInput) =>
    send<GridPreviewResult>(`/users/${encodeURIComponent(privyId)}/grid/preview`, input),
  gridStart: (privyId: string, input: GridPreviewInput) =>
    send<GridBotView>(`/users/${encodeURIComponent(privyId)}/grid/bots`, input),
  gridStop: (privyId: string, botId: string) =>
    send<GridBotView>(`/users/${encodeURIComponent(privyId)}/grid/bots/${botId}/stop`),

  // Signals (beta-gated on the backend).
  signalPresets: (privyId: string) => req<SignalPresets>(`/users/${encodeURIComponent(privyId)}/signals/presets`),
  signalAlerts: (privyId: string) =>
    req<{ alerts: SignalAlert[]; maxAlerts: number }>(`/users/${encodeURIComponent(privyId)}/signals/alerts`),
  createSignalAlert: (
    privyId: string,
    input: {
      symbol: string;
      preset: SignalPresetId;
      timeframe: SignalTimeframe;
      notifyMin: "confirmed" | "caution";
      exitPlan: SignalExitPlanId;
      params?: Record<string, number>;
    }
  ) => send<SignalAlert>(`/users/${encodeURIComponent(privyId)}/signals/alerts`, input),
  updateSignalAlert: async (privyId: string, id: string, patch: Partial<Pick<SignalAlert, "active" | "notifyMin" | "params">>) => {
    const auth = await authHeader();
    const res = await fetch(`${BASE}/users/${encodeURIComponent(privyId)}/signals/alerts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth },
      body: JSON.stringify(patch),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.message ?? `Request failed (${res.status})`);
    return json as SignalAlert;
  },
  deleteSignalAlert: (privyId: string, id: string) =>
    req<{ ok: true }>(`/users/${encodeURIComponent(privyId)}/signals/alerts/${id}`, { method: "DELETE" }),
  signalFeed: (privyId: string, before?: string) =>
    req<{ signals: SignalView[] }>(
      `/users/${encodeURIComponent(privyId)}/signals/feed${before ? `?before=${encodeURIComponent(before)}` : ""}`
    ),
  signal: (privyId: string, id: string) => req<SignalView>(`/users/${encodeURIComponent(privyId)}/signals/feed/${id}`),
  signalTaken: (privyId: string, id: string) => send<{ ok: true }>(`/users/${encodeURIComponent(privyId)}/signals/feed/${id}/taken`),
  signalSettings: (privyId: string) => req<SignalSettings>(`/users/${encodeURIComponent(privyId)}/signals/settings`),
  saveSignalSettings: (privyId: string, s: SignalSettings) =>
    req<SignalSettings>(`/users/${encodeURIComponent(privyId)}/signals/settings`, { method: "PUT", body: JSON.stringify(s) }),
  signalTrack: (privyId: string) => req<SignalTrack>(`/users/${encodeURIComponent(privyId)}/signals/track`),

  // Notifications. Every user has an inbox; not feature-gated.
  notifications: (privyId: string, before?: string) =>
    req<{ items: NotificationItem[]; unread: number }>(
      `/users/${encodeURIComponent(privyId)}/notifications${before ? `?before=${encodeURIComponent(before)}` : ""}`
    ),
  notificationsUnread: (privyId: string) =>
    req<{ unread: number }>(`/users/${encodeURIComponent(privyId)}/notifications/unread`),
  notificationsRead: (privyId: string, ids: string[] | "all") =>
    send<{ unread: number }>(`/users/${encodeURIComponent(privyId)}/notifications/read`, ids === "all" ? { all: true } : { ids }),
  notificationSettings: (privyId: string) =>
    req<NotificationSettings>(`/users/${encodeURIComponent(privyId)}/notifications/settings`),
  setNotificationPreference: (privyId: string, category: NotificationCategory, channel: NotificationChannel, enabled: boolean) =>
    req<NotificationSettings>(`/users/${encodeURIComponent(privyId)}/notifications/preferences`, {
      method: "PUT",
      body: JSON.stringify({ category, channel, enabled }),
    }),
  registerWebPush: (privyId: string, subscription: PushSubscriptionJSON) =>
    send<{ id: string }>(`/users/${encodeURIComponent(privyId)}/notifications/channels/webpush`, subscription),
  removeNotificationChannel: (privyId: string, channelId: string) =>
    req<{ ok: true }>(`/users/${encodeURIComponent(privyId)}/notifications/channels/${channelId}`, { method: "DELETE" }),
  telegramLink: (privyId: string) =>
    send<{ url: string; expiresInSeconds: number }>(`/users/${encodeURIComponent(privyId)}/notifications/telegram/link`),
  sendTestNotification: (privyId: string) =>
    send<{ id: string | null }>(`/users/${encodeURIComponent(privyId)}/notifications/test`),

  /** Public: the owner of a shared code, for the "invited by" line. */
  lookupReferral: (code: string): Promise<ReferralLookup> =>
    req<ReferralLookup>(`/referrals/${encodeURIComponent(code)}`),

  /** Fire-and-forget: a lost report must never affect the user's trade flow. */
  reportOrderFailure: (privyId: string, report: OrderFailureReport): void => {
    void req(`/users/${encodeURIComponent(privyId)}/order-failures`, {
      method: "POST",
      body: JSON.stringify({ ...report, message: report.message?.slice(0, 500) ?? null }),
    }).catch(() => undefined);
  },

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
