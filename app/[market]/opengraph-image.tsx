import { ImageResponse } from "next/og";
import { MARKET_ORDER, MARKET_SLUGS, MARKETS, marketFromSlug } from "@/lib/markets";

// Per-market OG/Twitter image, generated from the brand system (dark bg,
// brand-green lightning-T mark, market name). Drawn with plain flex boxes only —
// no local images, no SVG, no unsupported CSS — so Satori renders it reliably.
// Statically generated per market at build (Node runtime).
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
          padding: "80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top: brand lock-up. */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              width: "88px",
              height: "88px",
              borderRadius: "22px",
              background: UP,
              alignItems: "center",
              justifyContent: "center",
              fontSize: "56px",
              fontWeight: 800,
              color: BG,
            }}
          >
            T
          </div>
          <div
            style={{ fontSize: "44px", fontWeight: 700, color: TEXT, marginLeft: "22px" }}
          >
            Tradash
          </div>
        </div>

        {/* Middle: market identity. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: "38px", fontWeight: 600, color: MUTED }}>
            {m.symbol}-USD
          </div>
          <div style={{ fontSize: "116px", fontWeight: 800, color: TEXT, lineHeight: 1 }}>
            {m.label}
          </div>
          <div style={{ fontSize: "40px", fontWeight: 500, color: UP, marginTop: "18px" }}>
            Tap UP or DOWN. Trade instantly.
          </div>
        </div>

        {/* Bottom: brand-green underline accent (no SVG). */}
        <div
          style={{
            display: "flex",
            width: "260px",
            height: "10px",
            borderRadius: "999px",
            background: UP,
          }}
        />
      </div>
    ),
    { ...size }
  );
}
