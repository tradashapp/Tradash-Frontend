/** @type {import('next').NextConfig} */

/**
 * Security headers, required before taking Privy to production.
 *
 * The CSP is built from Privy's published requirements (auth.privy.io iframe,
 * Cloudflare Turnstile, WalletConnect, MoonPay on-ramp) PLUS every origin this
 * app actually talks to. A CSP that omits one of those does not warn — the
 * request is simply blocked at runtime, so the list below is deliberately
 * explicit rather than clever.
 *
 * Directives are assembled from named groups so each origin sits next to the
 * reason it is there; an unexplained domain in a security header is how these
 * rot.
 */

// --- Privy (embedded wallet + auth) ---
const PRIVY_FRAME = ["https://auth.privy.io"];
const PRIVY_CONNECT = [
  "https://auth.privy.io",
  // Privy's wallet RPC. Wildcard subdomain is what Privy documents.
  "https://*.rpc.privy.systems",
];

// --- WalletConnect / Coinbase Wallet, reachable through Privy's connectors ---
const WALLETCONNECT_FRAME = [
  "https://verify.walletconnect.com",
  "https://verify.walletconnect.org",
];
const WALLETCONNECT_CONNECT = [
  "wss://relay.walletconnect.com",
  "wss://relay.walletconnect.org",
  "wss://www.walletlink.org",
  "https://explorer-api.walletconnect.com",
];

// Cloudflare Turnstile — Privy's bot check. Needs BOTH script-src and
// frame-src: it loads a script that then renders a challenge iframe.
const TURNSTILE = ["https://challenges.cloudflare.com"];

// MoonPay — the fiat on-ramp behind `useFundWallet` (AccountSheet's "Fund
// wallet"). Omitting these leaves the button opening a blank frame.
const MOONPAY_FRAME = ["https://buy.moonpay.com", "https://www.moonpay.com"];
const MOONPAY_CONNECT = ["https://api.moonpay.com"];

// --- Our own backends and data sources ---
const BULK = [
  // Mainnet (production) and the testnet hosts, so a staging build on the same
  // header still works.
  "https://mainnet-api1.bulk.trade",
  "wss://mainnet-ws1.bulk.trade",
  "https://exchange-api.bulk.trade",
  "wss://exchange-ws1.bulk.trade",
];
const SOLANA_RPC = [
  // Wallet USDC reads + the vault deposit transaction.
  "https://mainnet.helius-rpc.com",
  // MagicBlock oracle (price feeds; stays devnet on purpose).
  "https://devnet.magicblock.app",
  "https://devnet-router.magicblock.app",
  "https://rpc.magicblock.app",
  // Solana web3.js opens a WS subscription alongside the HTTP endpoint.
  "wss://mainnet.helius-rpc.com",
  "wss://devnet.magicblock.app",
  "wss://rpc.magicblock.app",
];
const TRADASH_API = ["https://api.tradash.xyz"];

// Generated avatars are served straight from DiceBear (see lib/dicebearAvatar).
const AVATARS = ["https://api.dicebear.com"];

const csp = [
  `default-src 'self'`,
  // 'unsafe-eval' is required by the bulk-keychain WASM module; 'unsafe-inline'
  // covers Next's inline bootstrap scripts.
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${TURNSTILE.join(" ")}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${AVATARS.join(" ")}`,
  `font-src 'self' data:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  // Clickjacking defence, and the modern replacement for X-Frame-Options.
  `frame-ancestors 'none'`,
  `child-src 'self' blob: ${[...PRIVY_FRAME, ...WALLETCONNECT_FRAME].join(" ")}`,
  `frame-src 'self' ${[
    ...PRIVY_FRAME,
    ...WALLETCONNECT_FRAME,
    ...TURNSTILE,
    ...MOONPAY_FRAME,
  ].join(" ")}`,
  `connect-src 'self' ${[
    ...PRIVY_CONNECT,
    ...WALLETCONNECT_CONNECT,
    ...MOONPAY_CONNECT,
    ...BULK,
    ...SOLANA_RPC,
    ...TRADASH_API,
    ...AVATARS,
  ].join(" ")}`,
  // WASM instantiates from a blob URL.
  `worker-src 'self' blob:`,
  `manifest-src 'self'`,
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  // Next 16 runs on Turbopack by default. Empty config silences the
  // webpack/turbopack mismatch warning. When we wire bulk-keychain (WASM) in
  // Phase 2 we'll add any Turbopack-specific loader rules here.
  turbopack: {},

  async headers() {
    return [
      {
        // Every route, including the PWA manifest and OG image routes.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Legacy twin of `frame-ancestors 'none'`. Kept for older browsers
          // that do not honour the CSP directive; Privy asks for it by name.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No page here needs camera, mic or geolocation.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          // HTTPS-only for two years, subdomains included.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
