import { ImageResponse } from "next/og";

// Default OG/Twitter image for the root (/) — generic brand card. Per-market
// routes (/btc, /eth, /sol) provide their own market-specific images.
export const runtime = "edge";
export const alt = "Tradash — tap to trade perpetuals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const UP = "#72E912";
const BG = "#08090c";
const TEXT = "#e8eaed";

export default function OgImage() {
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
          backgroundImage: `radial-gradient(${"#1a1d26"} 2px, transparent 2px)`,
          backgroundSize: "40px 40px",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
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
          <div style={{ fontSize: 44, fontWeight: 700, color: TEXT }}>Tradash</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ fontSize: 104, fontWeight: 800, color: TEXT, lineHeight: 1 }}>
            Tap to trade.
          </div>
          <div style={{ fontSize: 44, fontWeight: 500, color: UP }}>
            Perpetuals, made instant.
          </div>
        </div>

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
