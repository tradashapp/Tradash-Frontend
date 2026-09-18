import { PHOENIX_API } from "./config";
import type {
  PhoenixCandle,
  PhoenixFill,
  PhoenixMarket,
  PhoenixTraderState,
} from "./types";

/**
 * Phoenix REST reads.
 *
 * WHY REST AND NOT THE SDK: the delegate signing path works over plain HTTP, so
 * the SDK buys nothing at runtime while adding a large dependency to a PWA
 * bundle. The SDK stays useful for primitives (PDA derivation, codecs, margin
 * maths) — see PHOENIX_MIGRATION_FEASIBILITY.md §16.
 *
 * ROUTE PREFIX IS `/v1/view/...`. The documented `/v1/exchange/...` 404s.
 * Routes here were taken from the SDK bundle and confirmed by calling them.
 *
 * Unlike Bulk, Phoenix uses real HTTP status codes — no 200-on-failure parsing.
 */

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PHOENIX_API}${path}`, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    // Phoenix puts a useful message in the body; surface it rather than a bare
    // status, since several routes 400 only because a query param is missing.
    const body = await res.text().catch(() => "");
    throw new Error(
      `Phoenix ${path} failed: ${res.status}${body ? ` — ${body.slice(0, 200)}` : ""}`
    );
  }
  return res.json() as Promise<T>;
}

/** Every market Phoenix lists. 82 live as of 2026-09-18. */
export function fetchMarkets(): Promise<PhoenixMarket[]> {
  return get<PhoenixMarket[]>("/v1/view/exchange/markets");
}

export function fetchExchangeStatus(): Promise<{
  active: boolean;
  runningState: string;
  /** Exchange-level feature flag — NOT a per-user access gate. */
  gated: boolean;
  withdrawalsAvailable: boolean;
}> {
  return get("/v1/view/exchange/status");
}

/**
 * Trader state for ONE subaccount, keyed by TRADER PDA.
 *
 * Passing a wallet address here returns `404 "Trader not found"`, which reads
 * like "no account" but only means "wrong key type". Derive the PDA first, or
 * use `fetchPortfolioState` which takes the authority.
 */
export function fetchTraderState(
  traderPda: string
): Promise<PhoenixTraderState> {
  return get<PhoenixTraderState>(`/v1/view/trader/${traderPda}`);
}

/**
 * Whole-portfolio state, keyed by AUTHORITY (wallet).
 *
 * Prefer this over `fetchTraderState` for "does this user have positions?":
 * positions are per-subaccount, so reading one PDA can report an empty account
 * for a trader who is active on another subaccount.
 */
export function fetchPortfolioState(authority: string): Promise<unknown> {
  return get(`/v1/trader/state/${authority}`);
}

/**
 * Fill history, keyed by AUTHORITY.
 *
 * Each fill carries server-computed `realizedPnl` and `fees` — both derived
 * client-side today on Bulk — plus `fillId` and `signature` as idempotency
 * keys. This is what lets history move server-side and close the gap where a
 * close during a WS disconnect leaves no row at all.
 */
export async function fetchTradesHistory(
  authority: string,
  limit = 100
): Promise<PhoenixFill[]> {
  const r = await get<{ data: PhoenixFill[] }>(
    `/v1/trader/${authority}/trades-history?limit=${limit}`
  );
  return r.data ?? [];
}

/**
 * OHLC candles.
 *
 * `from`/`to` are MILLISECONDS. Passing seconds returns `bars: []` with a 200 —
 * no error, just silently empty. Verified retention: 1m bars at least 7 days
 * back (Bulk kept ~192 minutes).
 */
export async function fetchCandles(
  symbol: string,
  timeframe: string,
  fromMs: number,
  toMs: number
): Promise<PhoenixCandle[]> {
  const r = await get<{ bars: PhoenixCandle[] }>(
    `/v1/candles_v2/${symbol}?timeframe=${timeframe}&from=${fromMs}&to=${toMs}`
  );
  return r.bars ?? [];
}
