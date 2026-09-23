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
const DOT = "#2a2e3a";

// The `.glass-sheet` recipe (globals.css) as ONE background value.
//
// Three satori rules are baked in here, each of which renders a blank card if
// broken — and breaks SILENTLY, since the route still answers 200 image/png:
//   1. Gradients must be comma-stacked on the element that shows them. Satori
//      drops a gradient painted by an absolutely-positioned overlay div.
//   2. Each gradient must sit on ONE line. A multi-line value throws
//      "object null is not iterable" and the response never pipes.
//   3. Radii are explicit px. Satori accepts `120% 60%` but resolves it to a
//      far tighter bloom than a browser, washing the glow out.
const SHEET_BG =
  "radial-gradient(1100px 620px at 20% -10%, rgba(114,233,18,0.20) 0%, rgba(114,233,18,0.06) 40%, rgba(114,233,18,0) 72%), " +
  "linear-gradient(to bottom, rgba(114,233,18,0.05) 0%, rgba(114,233,18,0.012) 22%, rgba(114,233,18,0) 45%), " +
  "linear-gradient(to bottom, #0b0e11 0%, #08090c 55%, #060709 100%)";

/** Inline a public/ asset as a data URI — satori cannot fetch a relative URL. */
function assetUri(relPath: string): string | null {
  try {
    const p = path.join(process.cwd(), "public", relPath);
    return `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
  } catch {
    return null;
  }
}

export default function Image() {
  // The horizontal lockup (790×316 → 2.5 aspect), not the square icon.
  const logoSrc = assetUri("images/logos/tradash-full.png");

  return new ImageResponse(
    (
      // Plain flex column. No absolute positioning anywhere: satori's layout
      // engine supports only a subset of CSS, and absolute children are where
      // this card silently lost its content before.
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: SHEET_BG,
          borderTop: "3px solid rgba(114,233,18,0.28)",
          padding: "30px 50px",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{
          display: "flex",
        }}>
          {logoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} width={200} height={80} alt="" />
          ) : (
            <span style={{ color: TEXT, fontSize: 40, fontWeight: 700 }}>Tradash</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <span
              style={{
                display: "flex",
                color: TEXT,
                fontSize: 92,
                fontWeight: 800,
                lineHeight: 1.08,
                letterSpacing: "-0.02em",
              }}
            >
              One Tap Away
            </span>
            <span
              style={{
                display: "flex",
                color: UP,
                fontSize: 92,
                fontWeight: 800,
                lineHeight: 1.08,
                letterSpacing: "-0.02em",
              }}
            >
              From Glory
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 50 }}>
            <span style={{ color: TEXT_MUTED, fontSize: 30, fontWeight: 500 }}>
              Perpetuals on Solana
            </span>
            <span style={{ color: DOT, fontSize: 30 }}>•</span>
            {/* 40x is BTC's ceiling in lib/markets.ts, the highest any market
              offers. Keep in step if that table changes. */}
            <span style={{ color: TEXT_MUTED, fontSize: 30, fontWeight: 500 }}>Up to 40x</span>
            <span style={{ color: DOT, fontSize: 30 }}>•</span>
            <span style={{ color: TEXT_MUTED, fontSize: 30, fontWeight: 500 }}>No gas</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
