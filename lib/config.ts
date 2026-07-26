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

  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
} as const;

export { required };
