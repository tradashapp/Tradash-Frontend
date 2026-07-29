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
    // "testnet" → new accounts are created/funded via the faucet during onboarding.
    // "mainnet" → the faucet step is skipped; accounts are funded by a real USDC
    // deposit (external transfer) instead. Flip this one value to go live.
    network: (process.env.NEXT_PUBLIC_BULK_NETWORK ?? "testnet") as
      | "testnet"
      | "mainnet",
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
} as const;

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
