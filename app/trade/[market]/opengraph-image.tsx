import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";
import { MARKETS, marketFromSlug } from "@/lib/markets";

// Per-market OG/Twitter image (/trade/BTC, …), rendered at request time.
// Node runtime, no generateStaticParams.
export const runtime = "nodejs";
export const alt = "Tradash | One Tap Away From Glory";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const UP = "#72E912";
const TEXT = "#e8eaed";
const TEXT_MUTED = "#8b90a0";

// Same `.glass-sheet` recipe as the root card, so the two read as one family.
// See app/opengraph-image.tsx for the three satori rules this string obeys —
// comma-stacked on the element that shows it, one line per gradient, px radii.
// Breaking any of them yields a BLANK card on a 200 image/png response.
const SHEET_BG =
  "radial-gradient(1100px 620px at 20% -10%, rgba(114,233,18,0.20) 0%, rgba(114,233,18,0.06) 40%, rgba(114,233,18,0) 72%), " +
  "linear-gradient(to bottom, rgba(114,233,18,0.05) 0%, rgba(114,233,18,0.012) 22%, rgba(114,233,18,0) 45%), " +
  "linear-gradient(to bottom, #0b0e11 0%, #08090c 55%, #060709 100%)";

/** Inline a public/ asset as a data URI — satori cannot fetch a relative URL. */
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

  const logoSrc = dataUri("images/logos/tradash-full.png", "image/png");
  const iconMime = m.logo.endsWith(".png")
    ? "image/png"
    : m.logo.endsWith(".svg")
      ? "image/svg+xml"
      : "image/jpeg";
  const iconSrc = dataUri(m.logo.replace(/^\//, ""), iconMime);

  return new ImageResponse(
    (
      // Plain flex column — no absolute positioning, which satori drops.
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: SHEET_BG,
          borderTop: "3px solid rgba(114,233,18,0.28)",
          padding: "68px 72px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Top row: wordmark + market pill. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} width={200} height={80} alt="" />
          ) : (
            <span style={{ color: TEXT, fontSize: 40, fontWeight: 700 }}>Tradash</span>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 26px",
              borderRadius: 999,
              border: "1px solid rgba(114,233,18,0.45)",
              background: "rgba(114,233,18,0.12)",
              color: UP,
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: "0.08em",
            }}
          >
            PERPETUALS
          </div>
        </div>

        {/* Bottom: market identity + tagline. */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
            {iconSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={iconSrc} width={96} height={96} alt="" style={{ borderRadius: 48 }} />
            ) : null}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  display: "flex",
                  color: TEXT_MUTED,
                  fontSize: 34,
                  fontWeight: 600,
                }}
              >
                {m.symbol}-USD
              </span>
              <span
                style={{
                  display: "flex",
                  color: TEXT,
                  fontSize: 88,
                  fontWeight: 800,
                  lineHeight: 1.05,
                  letterSpacing: "-0.02em",
                }}
              >
                {m.label}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 28 }}>
            <span style={{ display: "flex", color: UP, fontSize: 38, fontWeight: 600 }}>
              One Tap Away From Glory
            </span>
            <span style={{ color: "#2a2e3a", fontSize: 32 }}>•</span>
            {/* Per-market ceiling from lib/markets.ts, not a blanket number. */}
            <span style={{ color: TEXT_MUTED, fontSize: 32, fontWeight: 500 }}>
              Up to {m.maxLeverage}x
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
