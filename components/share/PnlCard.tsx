// The shareable PnL card, as real DOM.
//
// This replaced an imperative canvas renderer (`lib/share/pnlCard.ts`, kept only
// for its shared constants and data types). Everything here is ordinary HTML +
// inline styles, which buys us the app's real typography, real border radii and
// the same gradient the bottom sheets use — all of which had to be hand-drawn
// before. The PNG export goes through `html-to-image` instead of
// `canvas.toDataURL`, so the card the user downloads is the card they saw.
//
// LAYOUT (a fixed CARD_W×CARD_H rectangle, scaled down by the preview wrapper):
//
//   ┌──────────────────────────────────────────────┐
//   │ icon  Market            [ Up/40x pill ]      │
//   │       SYM-USD                                │
//   │                                              │
//   │ +$1,234.56  [+42%]        ← big PnL / ROI    │
//   │ Entry Price   $x                             │
//   │ Mark Price    $y                             │
//   │                                              │
//   │ [logo] Tradash                    ┌───────┐  │
//   │ Trade & share your own            │  QR   │  │
//   │ tradash.app/r/abc                 └───────┘  │
//   └──────────────────────────────────────────────┘
//
// Sizes are absolute pixels against CARD_W/CARD_H rather than rem or Tailwind
// classes: the node is rendered at full size off to the side and scaled with a
// CSS transform, so it must not depend on the surrounding font size or on
// Tailwind's own breakpoints. Inline styles also survive the html-to-image
// serialization without needing the app's stylesheet inlined.

import type { CSSProperties } from "react";
import { formatPrice } from "@/lib/format";
import { CARD_W, CARD_H, type PnlCardData, type ShareMetric } from "@/lib/share/pnlCard";

// Same palette the canvas version drew with, so a shared card looks unchanged
// apart from the intended edits.
const UP = "#72E912";
const DOWN = "#E6432D";
const TEXT = "#e8eaed";
const MUTED = "#8b90a0";

// The card's own outer padding — the market row, the PnL column and the footer
// all sit on this one margin.
const PAD = 80;

const SANS = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const fmtUsd = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

const hexA = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(
    h.slice(4, 6),
    16
  )},${a})`;
};

const prettyUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

export interface PnlCardProps {
  data: PnlCardData;
  metric: ShareMetric;
  /** QR code of the referral link, as a data URL. */
  qrDataUrl: string | null;
  /** Brand mark. */
  logoSrc?: string;
  /** Market icon (the coin logo). */
  marketIconSrc?: string;
}

/**
 * The card surface. Rendered at its true pixel size; the caller is responsible
 * for scaling it into whatever box it's previewed in (see `PnlCardPreview`).
 */
export function PnlCard({
  data,
  metric,
  qrDataUrl,
  logoSrc = "/icon-512.png",
  marketIconSrc,
}: PnlCardProps) {
  const profit = data.pnl >= 0;
  const accent = profit ? UP : DOWN;
  const up = data.direction === "long";
  const dirColor = up ? UP : DOWN;

  return (
    <div
      style={{
        position: "relative",
        width: CARD_W,
        height: CARD_H,
        padding: PAD,
        boxSizing: "border-box",
        overflow: "hidden",
        // Base surface. The dot grid and the corner gradient layer on top of
        // this via the absolutely-positioned siblings below, so each effect can
        // be tuned (or commented out) on its own.
        background: "linear-gradient(to bottom, #0b0e11 0%, #08090c 55%, #060709 100%)",
        color: TEXT,
        fontFamily: SANS,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Dot grid — the same 46px lattice the canvas drew, as a repeating
          radial gradient so it costs one paint instead of ~750 arcs. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "radial-gradient(#1a1d26 2.2px, transparent 2.2px)",
          backgroundSize: "46px 46px",
          backgroundPosition: "23px 23px",
        }}
      />

      {/* Brand glow filling the right-hand side — the space the mascot used to
          occupy. Deliberately the SAME gradient recipe as `.glass-sheet` in
          globals.css (brand green fading to nothing), just rotated to bloom from
          the right edge instead of the top, so the card and the sheet it's
          shared from read as one surface. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `
            radial-gradient(
              70% 120% at 100% 50%,
              rgba(114, 233, 18, 0.16) 0%,
              rgba(114, 233, 18, 0.05) 35%,
              rgba(114, 233, 18, 0) 70%
            ),
            linear-gradient(
              to left,
              rgba(114, 233, 18, 0.05) 0%,
              rgba(114, 233, 18, 0.012) 22%,
              rgba(114, 233, 18, 0) 45%
            )
          `,
        }}
      />

      {/* --- Market identity + direction pill (top row) --- */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          {marketIconSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={marketIconSrc}
              alt=""
              width={80}
              height={80}
              style={{ width: 80, height: 80, borderRadius: 40, display: "block" }}
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 52, fontWeight: 700, lineHeight: 1 }}>
              {data.marketLabel}
            </span>
            <span
              style={{ fontFamily: MONO, fontSize: 32, fontWeight: 500, color: MUTED, lineHeight: 1 }}
            >
              {data.symbol}-USD
            </span>
          </div>
        </div>

        {/* Up / Down + the leverage used, e.g. "Up/40x" — never long/short. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            height: 60,
            padding: "0 32px",
            borderRadius: 30,
            background: hexA(dirColor, 0.14),
            color: dirColor,
            fontSize: 34,
            fontWeight: 700,
          }}
        >
          <Triangle up={up} size={16} color={dirColor} />
          {`${up ? "Up" : "Down"}/${data.leverage}x`}
        </div>
      </div>

      {/* --- Big PnL / ROI, then the price rows. `flex: 1` pushes the footer to
          the bottom edge whichever metric is showing. --- */}
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 34,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 120,
              fontWeight: 800,
              color: accent,
              lineHeight: 1,
              letterSpacing: "-0.02em",
            }}
          >
            {metric === "roi" ? fmtPct(data.roiPct) : fmtUsd(data.pnl)}
          </span>
          {/* "both" mode: the ROI rides alongside as a glass chip. */}
          {metric === "both" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                height: 68,
                padding: "0 26px",
                borderRadius: 34,
                background: hexA(accent, 0.16),
                color: accent,
                fontFamily: MONO,
                fontSize: 40,
                fontWeight: 700,
              }}
            >
              <Triangle up={profit} size={15} color={accent} />
              {`${Math.abs(data.roiPct).toFixed(2)}%`}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <PriceRow label="Entry Price" value={`$${formatPrice(data.entryPrice)}`} />
          <PriceRow
            label={data.closed ? "Exit Price" : "Mark Price"}
            value={`$${formatPrice(data.markPrice)}`}
          />
        </div>
      </div>

      {/* --- Footer: brand + referral bottom-LEFT, QR bottom-RIGHT. --- */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoSrc}
              alt=""
              width={50}
              height={50}
              style={{ width: 50, height: 50, borderRadius: 16, display: "block" }}
            />
            <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>Tradash</span>
          </div>
          <span style={{ fontSize: 32, fontWeight: 500, color: MUTED, lineHeight: 1 }}>
            Trade &amp; share your own
          </span>
          <span style={{ fontSize: 38, fontWeight: 700, lineHeight: 1 }}>
            {prettyUrl(data.referralUrl)}
          </span>
        </div>

        {qrDataUrl && (
          <div
            style={{
              padding: 14,
              borderRadius: 20,
              background: "#ffffff",
              lineHeight: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt=""
              width={176}
              height={176}
              style={{ width: 176, height: 176, display: "block" }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PriceRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline" }}>
      <span style={{ width: 320, fontSize: 40, fontWeight: 500, color: MUTED }}>{label}</span>
      <span style={{ fontFamily: MONO, fontSize: 40, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

/** Filled up/down triangle — the marker inside the ROI chip and direction pill. */
function Triangle({ up, size, color }: { up: boolean; size: number; color: string }) {
  const style: CSSProperties = {
    width: 0,
    height: 0,
    borderLeft: `${size * 0.9}px solid transparent`,
    borderRight: `${size * 0.9}px solid transparent`,
  };
  return (
    <span
      style={
        up
          ? { ...style, borderBottom: `${size * 1.7}px solid ${color}` }
          : { ...style, borderTop: `${size * 1.7}px solid ${color}` }
      }
    />
  );
}

/**
 * Previews the card inside whatever box it's dropped into.
 *
 * The card keeps its true CARD_W×CARD_H pixel size — the exported PNG is always
 * the same rectangle, and the layout above is written in absolute pixels against
 * those numbers. So rather than making the card fluid, this renders it at full
 * size and scales it down with a CSS transform.
 *
 * `scale` comes from the parent's measured width (see ShareCardModal). The
 * transform lives on the OUTER node while `cardRef` — what html-to-image
 * captures — points at the untransformed card inside it, so the export is always
 * full resolution no matter how small the preview is.
 */
export function PnlCardPreview({
  scale,
  cardRef,
  ...props
}: PnlCardProps & { scale: number; cardRef: React.Ref<HTMLDivElement> }) {
  return (
    <div
      style={{
        width: CARD_W,
        height: CARD_H,
        transform: `scale(${scale})`,
        transformOrigin: "top left",
      }}
    >
      <div ref={cardRef} style={{ width: CARD_W, height: CARD_H }}>
        <PnlCard {...props} />
      </div>
    </div>
  );
}
