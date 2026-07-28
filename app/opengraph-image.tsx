import { ImageResponse } from "next/og";
import fs from "fs";
import path from "path";

// Default OG/Twitter image for the root (/) — generic brand card. Per-market
// routes (/trade/BTC, …) provide their own. Node runtime, next/og.
export const runtime = "nodejs";
export const alt = "Tradash — tap to trade perpetuals";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const UP = "#72E912";
const BG = "#08090c";

function logoUri(): string | null {
  try {
    const p = path.join(process.cwd(), "public", "icon.svg");
    return `data:image/svg+xml;base64,${fs.readFileSync(p).toString("base64")}`;
  } catch {
    return null;
  }
}

export default function Image() {
  const logoSrc = logoUri();
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
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {logoSrc ? (
              <img src={logoSrc} width={80} height={80} alt="" style={{ borderRadius: 20 }} />
            ) : null}
            <span style={{ color: "#e8eaed", fontSize: 40, fontWeight: 700 }}>
              Tradash
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ color: "#e8eaed", fontSize: 96, fontWeight: 800, lineHeight: 1 }}>
              Tap to trade.
            </span>
            <span style={{ color: UP, fontSize: 44, fontWeight: 500 }}>
              Perpetuals, made instant.
            </span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
