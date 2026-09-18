/**
 * Phoenix Perpetuals endpoints.
 *
 * MAINNET ONLY. Phoenix publishes no devnet, testnet, staging or sandbox for
 * perps — `ws-api-best-practices` references only this host and
 * api.mainnet-beta.solana.com. There is no network switch to add here, and a
 * "testnet" value would be a lie rather than a safety net. Pre-production
 * testing is LiteSVM fixtures or small real-money trades.
 *
 * Contrast with `config.bulk.network`, which selects a SIGNATURE DOMAIN and so
 * had to be switchable. Phoenix signs ordinary Solana transactions, so the
 * network is fixed by the RPC the wallet talks to.
 */
export const PHOENIX_API =
  process.env.NEXT_PUBLIC_PHOENIX_API_URL ?? "https://perp-api.phoenix.trade";

export const PHOENIX_WS =
  process.env.NEXT_PUBLIC_PHOENIX_WS_URL ??
  "wss://perp-api.phoenix.trade/v1/ws";

/** On-chain program that owns trader PDAs. Verified live 2026-09-18. */
export const PHOENIX_PROGRAM_ID =
  "EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih";
