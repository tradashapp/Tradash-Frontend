import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";
import { MARKETS, marketFromSlug } from "@/lib/markets";

// Per-market OG/Twitter image, rendered at request time with next/og (Node
// runtime — matches the working reference: nodejs + no generateStaticParams).
// Layered absolute layout, assets read from /public as base64 data URIs.
export const runtime = "nodejs";
export const alt = "Tradash — tap to trade perpetuals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const UP = "#72E912";
const BG = "#08090c";

function dataUri(relFromPublic: string, mime: string): string | null {
  try {
    const p = path.join(process.cwd(), "public", relFromPublic);
    return `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  const symbol = marketFromSlug(market) ?? "BTC";
  const m = MARKETS[symbol];

  // Brand logo (lightning-T) + the market icon, embedded as data URIs.
  const logoSrc = dataUri("icon.svg", "image/svg+xml");
  const iconMime = m.logo.endsWith(".png")
    ? "image/png"
    : m.logo.endsWith(".svg")
      ? "image/svg+xml"
      : "image/jpeg";
  const iconSrc = dataUri(m.logo.replace(/^\//, ""), iconMime);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: BG,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Green glow — top right. */}
        <div
          style={{
            position: "absolute",
            top: -160,
            right: -160,
            width: 560,
            height: 560,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(114,233,18,0.28) 0%, transparent 70%)`,
          }}
        />
        {/* Green glow — bottom left. */}
        <div
          style={{
            position: "absolute",
            bottom: -120,
            left: -100,
            width: 380,
            height: 380,
            borderRadius: "50%",
            background: `radial-gradient(circle, rgba(114,233,18,0.16) 0%, transparent 70%)`,
          }}
        />

        {/* Content layer. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "64px 72px",
          }}
        >
          {/* Top row: brand + UP/DOWN badge. */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {logoSrc ? (
                <img src={logoSrc} width={80} height={80} alt="" style={{ borderRadius: 20 }} />
              ) : null}
              <span style={{ color: "#e8eaed", fontSize: 40, fontWeight: 700 }}>
                Tradash
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "12px 26px",
                borderRadius: 999,
                border: `1px solid rgba(114,233,18,0.45)`,
                background: `rgba(114,233,18,0.12)`,
                color: UP,
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: "0.08em",
              }}
            >
              PERPETUALS
            </div>
          </div>

          {/* Bottom row: market identity + tagline. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              {iconSrc ? (
                <img
                  src={iconSrc}
                  width={96}
                  height={96}
                  alt=""
                  style={{ borderRadius: 999 }}
                />
              ) : null}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span style={{ color: "#8b90a0", fontSize: 34, fontWeight: 600 }}>
                  {m.symbol}-USD
                </span>
                <span style={{ color: "#e8eaed", fontSize: 92, fontWeight: 800, lineHeight: 1 }}>
                  {m.label}
                </span>
              </div>
            </div>
            <span style={{ color: UP, fontSize: 40, fontWeight: 500 }}>
              Tap UP or DOWN. Trade instantly.
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
