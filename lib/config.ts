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

/** Live price feed behind the chart — see `config.chartFeed`. */
export type ChartFeed = "bulk" | "magicblock";

/**
 * Normalise the public origin used for `metadataBase` (and share links).
 *
 * Link previews fail SILENTLY when this is wrong: the og:image route keeps
 * serving a valid PNG, and only the scraper — which never follows a redirect
 * and never reports back — sees the 308 or the dead host. So rather than trust
 * the deploy env, fix the two mistakes that have actually shipped:
 *   - the retired `tradash.app` host (NXDOMAIN), and
 *   - the bare `tradash.xyz` apex, which 308-redirects to `www`.
 * Anything else (preview URLs, localhost, a future domain) passes through
 * untouched — this guards known-bad values, it does not pin the origin.
 */
function canonicalAppUrl(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim().replace(/\/+$/, "");
  if (!trimmed) return fallback;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return fallback; // Not a usable absolute origin.
  }

  // The dead domain, in any subdomain form. Nothing there answers.
  if (url.hostname === "tradash.app" || url.hostname.endsWith(".tradash.app")) {
    return fallback;
  }
  // The apex redirects to www; crawlers drop the image rather than follow it.
  if (url.hostname === "tradash.xyz") {
    url.hostname = "www.tradash.xyz";
    return url.origin;
  }
  return url.origin;
}

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

  // Which feed drives the chart (and every chart-space price: PnL interpolation,
  // entry/liq lines, TP/SL, trailing). "bulk" = Bulk's own ticker markPrice, so
  // the chart shares one price space with every Bulk quote and no line needs
  // shifting. "magicblock" = the MagicBlock oracle, kept wired so we can switch
  // back by flipping NEXT_PUBLIC_CHART_FEED — no code changes. Markets with no
  // MagicBlock feed (priceSource "bulk", e.g. PUMP) stay on Bulk either way.
  chartFeed: (process.env.NEXT_PUBLIC_CHART_FEED === "magicblock"
    ? "magicblock"
    : "bulk") as ChartFeed,

  magicblock: {
    // PRICE FEEDS ONLY — read-only, never signs and never touches funds.
    //
    // These stay on devnet even when Bulk is on mainnet, on purpose. The oracle
    // program is deployed on both and publishes the SAME live Pyth-Lazer prices
    // (verified 2026-09-05: BTC $80,080.7 devnet vs $80,082.1 mainnet), while
    // devnet needs no API key — mainnet does. Since nothing here is network-
    // bound, devnet is the cheaper source of an identical number.
    erUrl:
      process.env.NEXT_PUBLIC_MAGICBLOCK_ER_URL ??
      "https://devnet.magicblock.app",
    routerUrl:
      process.env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL ??
      "https://devnet-router.magicblock.app",
    // Base-layer RPC for the oracle (snapshots / non-streaming reads).
    rpcUrl:
      process.env.NEXT_PUBLIC_MAGICBLOCK_RPC_URL ??
      "https://rpc.magicblock.app/devnet",
  },

  solana: {
    // Base-layer RPC for REAL-MONEY reads: the user's wallet USDC balance, which
    // backs deposits. Deliberately NOT shared with the oracle URLs above — see
    // solanaRpcUrl() for why a devnet value here fails silently rather than loudly.
    rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "",
    // USDC mint per Bulk network — devnet mint on devnet/testnet, the canonical
    // mainnet mint on mainnet (see usdcMint() below).
    usdcMintDevnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    usdcMintMainnet: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },

  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",

  // Public site origin — used to build referral links (domain/?ref=<code>)
  // AND as `metadataBase`, which is what turns the
  // OG/Twitter image routes into the absolute URLs crawlers fetch.
  //
  // The fallback MUST be the real, canonical, non-redirecting origin. It used
  // to be tradash.app (a dead domain), so any deploy without
  // NEXT_PUBLIC_APP_URL set advertised og:image at a host that answered
  // nothing — every scraper reported "image is invalid" while the image route
  // itself served a perfectly good PNG.
  //
  // `www` is deliberate: the apex 308-redirects to www, and Telegram/X do not
  // follow redirects when fetching an image.
  //
  // A correct fallback is not enough on its own: a deploy that SETS
  // NEXT_PUBLIC_APP_URL to the bare apex (or to the old tradash.app) overrides
  // it and reintroduces the exact same broken previews. canonicalAppUrl()
  // normalises that away, so the value below is a floor, not a hope.
  appUrl: canonicalAppUrl(process.env.NEXT_PUBLIC_APP_URL, "https://www.tradash.xyz"),

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

/**
 * The base-layer Solana RPC for wallet USDC reads.
 *
 * On mainnet this MUST be a real mainnet RPC and there is no safe default, so a
 * missing value throws here rather than falling back.
 *
 * The failure this guards against is silent, not loud: the mainnet USDC mint
 * address ALSO resolves to an unrelated account on devnet, so querying it over a
 * devnet RPC returns an empty token-account list instead of an error. Every user
 * would see a $0 wallet balance and be unable to deposit, with nothing logged
 * anywhere. Verified 2026-09-05 — rpc.magicblock.app/devnet reports the devnet
 * genesis hash yet still answers for the mainnet mint.
 *
 * Note rpc.magicblock.app/mainnet returns 401 `invalid api key`, so this needs a
 * keyed provider (Helius / Triton / QuickNode).
 */
export function solanaRpcUrl(): string {
  const url = config.solana.rpcUrl;
  if (url) return url;
  if (config.bulk.network === "mainnet") {
    throw new Error(
      "Missing NEXT_PUBLIC_SOLANA_RPC_URL. On mainnet this must be a mainnet " +
        "Solana RPC — without it wallet USDC balances silently read as $0."
    );
  }
  // devnet/testnet: the MagicBlock base layer is devnet and serves the devnet mint.
  return config.magicblock.rpcUrl;
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

/** A referral link for a code (see lib/referral.ts); the bare domain without one. */
export function referralLink(code?: string | null): string {
  const origin = siteOrigin().replace(/\/$/, "");
  return code ? `${origin}/?ref=${encodeURIComponent(code)}` : origin;
}

export { required };
