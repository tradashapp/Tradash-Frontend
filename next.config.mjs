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
  // Public indexer — Bulk Aura points (AuraPanel).
  "https://indexer.bulk.trade",
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
// Our backend. Read from the same env the client uses, so whatever the app is
// actually pointed at is allowed — otherwise a deploy against a staging API,
// or a local `npm run dev` against localhost:4000, is blocked by a CSP that
// only ever names production. Falls back to the prod host when unset.
// A production build must never allowlist a plain-http or localhost API, even
// if the build machine's .env.local still points there — that would ship a
// header trusting an origin no user can reach and silently weaken the policy.
const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://api.tradash.xyz";
const apiIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(apiUrl);
const TRADASH_API =
  apiIsLocal && process.env.NODE_ENV === "production"
    ? ["https://api.tradash.xyz"]
    : [apiUrl];

// Vercel Web Analytics (<Analytics /> in app/layout.tsx) loads its script from
// this host and beacons back to it. Without both entries the script is blocked
// and the console fills with a failure that looks like an ad-blocker problem.
const VERCEL_ANALYTICS = [
  "https://va.vercel-scripts.com",
  "https://vitals.vercel-insights.com",
];

// Dev-only allowances. `next dev` talks to its HMR websocket on the page's own
// origin, and the local backend is plain http — neither belongs in a production
// header, so they are added only when building for development.
const isDev = process.env.NODE_ENV !== "production";
const DEV_CONNECT = isDev
  ? ["ws://localhost:*", "http://localhost:*", "https://localhost:*"]
  : [];

// Generated avatars are served straight from DiceBear (see lib/dicebearAvatar).
const AVATARS = ["https://api.dicebear.com", "https://pewxmadlhipexjnwqijx.supabase.co"];

const csp = [
  `default-src 'self'`,
  // 'unsafe-eval' is required by the bulk-keychain WASM module; 'unsafe-inline'
  // covers Next's inline bootstrap scripts.
  `script-src 'self' 'unsafe-eval' 'unsafe-inline' ${[
    ...TURNSTILE,
    ...VERCEL_ANALYTICS,
  ].join(" ")}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob: ${AVATARS.join(" ")}`,
  `font-src 'self' data:`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  // Clickjacking defence: nobody may embed US.
  //
  // Note this governs who can frame THIS document — it is unrelated to the
  // Privy iframe we host (that is `frame-src`/`child-src` below). Privy sends
  // its OWN frame-ancestors on auth.privy.io naming the app's allowed domains,
  // which is why a login popup fails with a frame-ancestors error until the
  // origin is registered in the Privy dashboard — nothing here can fix that.
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
    ...VERCEL_ANALYTICS,
    ...DEV_CONNECT,
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
