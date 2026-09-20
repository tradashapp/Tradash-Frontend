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

/**
 * Flight — the proxy program that collects BUILDER FEES.
 *
 * With `flight` configured on the SDK client (`sdkClient.ts`), order-placing
 * instructions come back targeting THIS program instead of Phoenix directly:
 * Flight wraps the Phoenix instruction and settles our fee to the builder's
 * trader account in the same transaction.
 *
 * So any guard that asserts "this instruction must target Phoenix" has to
 * accept Flight too, or enabling builder fees breaks every order with
 * *"Refusing instruction for F1ightu9…, not Phoenix"*.
 *
 * Matches `FLIGHT_PROGRAM_ADDRESS` in the SDK
 * (`flight/core/constants.ts`), which is not re-exported from the package
 * root — hence the copy here rather than an import. Verified on chain
 * 2026-09-20: exists, `executable: true`, owned by the BPF upgradeable loader.
 */
export const FLIGHT_PROGRAM_ID =
  "F1ightu9cujFYo34k9CabifLrJT8qzfDVM2Q7BqhJn2W";
