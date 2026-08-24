// Central place for environment-derived config. Reading env here (rather than
// scattering process.env across the app) keeps the required keys documented in
// one spot and makes missing-config failures loud and early.

function required(name: string, value: string | undefined): string {
  if (!value) {
    // In dev we warn rather than throw so the visual milestone can run before
    // every integration key is filled in. Integrations check this themselves.
    if (process.env.NODE_ENV === "development") {
      console.warn(`[config] missing env: ${name}`);
      return "";
    }
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

/**
 * The Bulk network we sign for. Since Bulk v1.0.17 this is not just a funding
 * switch — it selects the SIGNATURE DOMAIN that every signed transaction is
 * bound to, so it must match the network `restUrl` points at.
 */
export type BulkNetwork = "devnet" | "testnet" | "mainnet";

export const config = {
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "",

  bulk: {
    // Verified base: exchange-api.bulk.trade/api/v1 (mutations POST /order, reads POST /account).
    restUrl:
      process.env.NEXT_PUBLIC_BULK_REST_URL ??
      "https://exchange-api.bulk.trade/api/v1",
    accountWsUrl:
      process.env.NEXT_PUBLIC_BULK_ACCOUNT_WS_URL ??
      "wss://exchange-ws1.bulk.trade",
    // "devnet"/"testnet" → new accounts are created/funded via the faucet during
    // onboarding. "mainnet" → the faucet step is skipped; accounts are funded by
    // a real USDC deposit (external transfer) instead. Flip this one value to go
    // live. This ALSO selects the signature domain — see signatureDomain() below.
    // VERIFIED live 2026-08-03 by signing a faucet claim under each domain
    // against exchange-api.bulk.trade: "testnet" is accepted, "devnet" and
    // "mainnet" both return `bad signature`. Note this is the SIGNATURE domain
    // and is independent of MagicBlock's devnet URLs — don't assume they match.
    network: (process.env.NEXT_PUBLIC_BULK_NETWORK ?? "testnet") as BulkNetwork,
  },

  builder: {
    // Our revenue: recipient collects the builder fee; bps is capped 1-15 by Bulk.
    recipient: process.env.NEXT_PUBLIC_BUILDER_RECIPIENT ?? "",
    feeBps: Number(process.env.NEXT_PUBLIC_BUILDER_FEE_BPS ?? "0"),
  },

  magicblock: {
    // Ephemeral Rollup endpoint — the price feeds stream live here (~16 ticks/s).
    erUrl:
      process.env.NEXT_PUBLIC_MAGICBLOCK_ER_URL ??
      "https://devnet.magicblock.app",
    routerUrl:
      process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL ??
      "https://devnet-router.magicblock.app",
    // Base-layer RPC (snapshots / non-streaming reads).
    rpcUrl:
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      "https://rpc.magicblock.app/devnet",
  },

  solana: {
    // Base-layer RPC used for wallet reads (USDC balance) — shares the same node
    // as the MagicBlock base layer unless overridden.
    rpcUrl:
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      "https://rpc.magicblock.app/devnet",
    // USDC mint per Bulk network. Bulk is on devnet today, so the deposit/withdraw
    // and wallet-balance reads use the devnet USDC mint; flipping BULK_NETWORK to
    // mainnet swaps in the canonical mainnet USDC mint (see usdcMint() below).
    usdcMintDevnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    usdcMintMainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },

  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",

  // Public site origin — used to build shareable PnL-card referral links
  // (domain/?ref=<username>). Usernames don't exist yet, so the link is the bare
  // domain for now. Prefers the live origin at runtime, falling back to the env.
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://tradash.app",

  // Community / docs destinations shown in the landing-page footer. Env-
  // overridable so the links can be pointed at the real channels without a
  // code change.
  social: {
    docs: process.env.NEXT_PUBLIC_DOCS_URL ?? "https://docs.tradash.app",
    x: process.env.NEXT_PUBLIC_X_URL ?? "https://x.com/tradashapp",
    discord: process.env.NEXT_PUBLIC_DISCORD_URL ?? "https://discord.gg/XXhdDaR2X",
    telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL ?? "https://t.me/tradashapp",
  },
} as const;

/**
 * The signature domain for the active Bulk network.
 *
 * Bulk v1.0.17 (31 Jul 2026) made every signed transaction network-bound: the
 * signing preimage is
 *   wincode(actions) || nonce_le_u64 || account_pubkey_32 || signature_domain_u8
 * (the nonce is nanoseconds — see `nonceNs` below)
 * with the domain byte appended last (mainnet 1, testnet 2, devnet 3).
 *
 * CRITICAL: the domain is *trusted client configuration*. It is NOT sent as a
 * JSON field or header — the server rebuilds the preimage with its OWN domain
 * and compares. So a domain that doesn't match the network `restUrl` points at
 * fails as an opaque `bad signature`, identical to a genuinely corrupt one.
 * There is no server-side error that names the domain as the cause. Keep this
 * derived from `network` and never pass it by hand.
 *
 * The keychain WASM takes the NAME, not the byte, and rejects anything else.
 */
export function signatureDomain(): BulkNetwork {
  const n = config.bulk.network;
  if (n !== "devnet" && n !== "testnet" && n !== "mainnet") {
    // Fail loudly here: the alternative is an unexplainable `bad signature` on
    // every order, faucet claim, and agent-wallet authorization.
    throw new Error(
      `Invalid NEXT_PUBLIC_BULK_NETWORK: ${JSON.stringify(n)} (expected devnet, testnet, or mainnet)`
    );
  }
  return n;
}

/**
 * A fresh nonce for a signed Bulk transaction, in NANOSECONDS, as a string.
 *
 * Bulk treats the nonce as a timestamp and rejects anything outside a narrow
 * freshness window with `transactionRejected: {reason:"expired"}` — an opaque
 * error that names neither the nonce nor its units. Verified live 2026-08-24
 * against exchange-api.bulk.trade: ms, seconds and microseconds ALL come back
 * `expired`; only nanoseconds are accepted (faucet then returns a real
 * `{deposit:{amount:1000}}`). This is what broke onboarding — every
 * master-signed action (faucet, agent wallet, builder code) was rejected, the
 * account was never created, and `/account` 500d for the "$0 balance" the Bulk
 * team described.
 *
 * It MUST be a string: `Date.now() * 1e6` is ~1.79e18, far past
 * Number.MAX_SAFE_INTEGER, so a JS number silently loses the low digits — and
 * keychain >= 0.1.24 rejects it outright ("can't be represented as a JavaScript
 * number"). The keychain's own `nonce` params are typed `string` for this
 * reason. Build it with BigInt so no precision is lost on the way.
 */
export function nonceNs(): string {
  return (BigInt(Date.now()) * 1_000_000n).toString();
}

/** The USDC mint for the active Bulk network (devnet today, mainnet when live). */
export function usdcMint(): string {
  return config.bulk.network === "mainnet"
    ? config.solana.usdcMintMainnet
    : config.solana.usdcMintDevnet;
}

/** The public origin for share links — the real origin in the browser, else config. */
export function siteOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return config.appUrl;
}

/** Referral link for a PnL share card. No usernames yet → bare domain. */
export function referralLink(username?: string | null): string {
  const origin = siteOrigin().replace(/\/$/, "");
  return username ? `${origin}/?ref=${encodeURIComponent(username)}` : origin;
}

export { required };
