import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";

// Default OG/Twitter image for the root (/) — generic brand card. Per-market
// routes (/trade/BTC, …) provide their own. Node runtime, next/og.
export const runtime = "nodejs";
export const alt = "Tradash — One Tap Away From Glory";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const UP = "#72E912";
const TEXT = "#e8eaed";
const TEXT_MUTED = "#8b90a0";

/**
 * Inline a public/ asset as a data URI.
 *
 * next/og cannot fetch a relative URL at build time — there is no origin to
 * resolve it against — so every image has to be embedded in the payload.
 */
function assetUri(relPath: string): string | null {
  try {
    const p = path.join(process.cwd(), "public", relPath);
    return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
  } catch {
    // A missing asset must not 500 the card: the layout below degrades to
    // wordmark-less and still renders.
    return null;
  }
}

export default function Image() {
  // The horizontal lockup (790×316), not the square icon — it reads as a
  // brand mark at small sizes in a timeline.
  const logoSrc = assetUri("images/logos/tradash-full.png");

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          // The whole `.glass-sheet` recipe (globals.css) in ONE value: brand
          // bloom, vertical wash, then the near-black base.
          //
          // Two satori constraints are baked into this string, both of which
          // cost a render to find:
          //   1. It must be comma-stacked here rather than painted by an
          //      absolutely-positioned overlay div — satori silently drops a
          //      gradient on such a div and renders nothing.
          //   2. Each gradient must sit on ONE line; a multi-line value throws
          //      "object null is not iterable" and the response never pipes.
          background:
            "radial-gradient(1100px 620px at 20% -10%, rgba(114,233,18,0.20) 0%, rgba(114,233,18,0.06) 40%, rgba(114,233,18,0) 72%), " +
            "linear-gradient(to bottom, rgba(114,233,18,0.05) 0%, rgba(114,233,18,0.012) 22%, rgba(114,233,18,0) 45%), " +
            "linear-gradient(to bottom, #0b0e11 0%, #08090c 55%, #060709 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* The sheet's top hairline, which is where its green edge lives. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: "rgba(114, 233, 18, 0.28)",
          }}
        />

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 56,
            padding: "72px 72px",
          }}
        >
          {/* Logo, top left. */}
          <div style={{ display: "flex", alignItems: "center" }}>
            {logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoSrc} width={250} height={100} alt="" style={{ display: "block" }} />
            ) : (
              <span style={{ color: TEXT, fontSize: 44, fontWeight: 700 }}>Tradash</span>
            )}
          </div>

          {/* Headline block, bottom left. */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                color: TEXT,
                fontSize: 92,
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                display: "flex",
              }}
            >
              One Tap Away
            </span>
            <span
              style={{
                color: UP,
                fontSize: 92,
                fontWeight: 800,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                display: "flex",
              }}
            >
              From Glory
            </span>

            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 28 }}>
              <span style={{ color: TEXT_MUTED, fontSize: 30, fontWeight: 500 }}>
                Perpetuals on Solana
              </span>
              <span style={{ color: "#2a2e3a", fontSize: 30 }}>•</span>
              {/* 40x is BTC's ceiling in lib/markets.ts — the highest any
                  market offers. Keep in step if that table changes. */}
              <span style={{ color: TEXT_MUTED, fontSize: 30, fontWeight: 500 }}>
                Up to 40x
              </span>
              <span style={{ color: "#2a2e3a", fontSize: 30 }}>•</span>
              <span style={{ color: TEXT_MUTED, fontSize: 30, fontWeight: 500 }}>
                No gas
              </span>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
