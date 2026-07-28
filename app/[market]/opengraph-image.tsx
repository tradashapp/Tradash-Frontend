import { ImageResponse } from "next/og";
import { MARKET_ORDER, MARKET_SLUGS, MARKETS, marketFromSlug } from "@/lib/markets";

// Per-market OG/Twitter image, generated from the same brand system (dark bg,
// brand-green lightning-T logo, market name, chart motif). Drawn with primitives
// only — no local image loading — so it renders reliably. Statically generated
// per market at build time (Node runtime; edge can't pair with static params).
export const alt = "Tradash — tap to trade perpetuals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return MARKET_ORDER.map((sym) => ({ market: MARKET_SLUGS[sym] }));
}

const UP = "#72E912";
const BG = "#08090c";
const TEXT = "#e8eaed";
const MUTED = "#8b90a0";

export default async function OgImage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  const symbol = marketFromSlug(market) ?? "BTC";
  const m = MARKETS[symbol];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: BG,
          // Subtle dot-grid backdrop via a radial pattern.
          backgroundImage: `radial-gradient(${"#1a1d26"} 2px, transparent 2px)`,
          backgroundSize: "40px 40px",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top: brand lock-up. */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <Logo />
          <div style={{ fontSize: 44, fontWeight: 700, color: TEXT }}>
            Tradash
          </div>
        </div>

        {/* Middle: market identity. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: 38, fontWeight: 600, color: MUTED }}>
            {m.symbol}-USD
          </div>
          <div style={{ fontSize: 108, fontWeight: 800, color: TEXT, lineHeight: 1 }}>
            {m.label}
          </div>
          <div style={{ fontSize: 40, fontWeight: 500, color: UP, marginTop: 12 }}>
            Tap UP or DOWN. Trade instantly.
          </div>
        </div>

        {/* Bottom: a simple upward chart motif in brand green. */}
        <div style={{ display: "flex" }}>
          <svg width={1056} height={120} viewBox="0 0 1056 120" fill="none">
            <path
              d="M0 96 L176 72 L352 84 L528 40 L704 60 L880 20 L1056 32"
              stroke={UP}
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    ),
    { ...size }
  );
}

// The lightning-T brand mark on a brand-green rounded square (inline so Satori
// needs no external asset).
function Logo() {
  return (
    <div
      style={{
        width: 88,
        height: 88,
        borderRadius: 22,
        background: UP,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width={56} height={56} viewBox="0 0 512 512">
        <g fill={BG}>
          <rect x="120" y="128" width="272" height="54" rx="12" />
          <path d="M292 178 L206 300 L258 300 L222 402 L336 262 L280 262 L322 178 Z" />
        </g>
      </svg>
    </div>
  );
}
