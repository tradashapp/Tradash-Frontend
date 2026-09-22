"use client";

// TEMPORARY dev harness: exercises the REAL export path (same asset preload,
// same decode gate, same double-pass toPng) and renders the resulting PNG back
// into the page so the exported bytes can be inspected directly. Delete once the
// missing-image bug is confirmed fixed.

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { toPng } from "html-to-image";
import { PnlCard } from "@/components/share/PnlCard";
import { CARD_W, CARD_H, ensureCardFonts, type PnlCardData } from "@/lib/share/pnlCard";

const DATA: PnlCardData = {
  symbol: "BTC",
  marketLabel: "Bitcoin",
  direction: "long",
  leverage: 40,
  pnl: 1234.56,
  roiPct: 42.31,
  entryPrice: 94210.5,
  markPrice: 96880.25,
  closed: false,
  referralUrl: "https://tradash.app/r/abc123",
};

async function toDataUrl(src: string): Promise<string | undefined> {
  try {
    const blob = await fetch(src).then((r) => (r.ok ? r.blob() : null));
    if (!blob) return undefined;
    return await new Promise<string | undefined>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : undefined);
      fr.onerror = () => resolve(undefined);
      fr.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

async function decodeDataUrl(src: string | undefined): Promise<void> {
  if (!src) return;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
  } catch {
    /* noop */
  }
}

export default function Harness() {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [qr, setQr] = useState<string | undefined>();
  const [logo, setLogo] = useState<string | undefined>();
  const [icon, setIcon] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [png, setPng] = useState<string | null>(null);
  const [report, setReport] = useState<string>("");

  // Mirrors ShareCardModal's loading effect exactly.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [q, l, i] = await Promise.all([
        QRCode.toDataURL(DATA.referralUrl, {
          margin: 0,
          width: 220,
          color: { dark: "#08090c", light: "#ffffff" },
        }).catch(() => undefined),
        toDataUrl("/icon-512.png"),
        toDataUrl("/images/crypto/btc.png"),
        ensureCardFonts(),
      ]);
      if (!alive) return;
      setQr(q);
      setLogo(l);
      setIcon(i);
      requestAnimationFrame(() => alive && setReady(true));
    })();
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(async () => {
    const node = cardRef.current;
    if (!node) return;
    const opts = {
      width: CARD_W,
      height: CARD_H,
      pixelRatio: 1,
      cacheBust: false,
      style: { transform: "none", opacity: "1" },
    };
    const url = await toPng(node, opts);
    setPng(url);

    // Inspect the exported pixels at the three image locations. Each probe is a
    // small box well inside the artwork; a blank export leaves these at the card
    // background, so "did this image make it" is a colour-variance question.
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = CARD_W;
    c.height = CARD_H;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);

    const probes: [string, number, number, number, number][] = [
      // x, y, w, h — coin icon, brand logo, QR block
      ["coin icon", 90, 90, 60, 60],
      ["brand logo", 85, 855, 40, 40],
      ["qr code", 1360, 800, 150, 150],
    ];
    const lines = probes.map(([name, x, y, w, h]) => {
      const d = ctx.getImageData(x, y, w, h).data;
      let min = 255;
      let max = 0;
      let sum = 0;
      for (let p = 0; p < d.length; p += 4) {
        const lum = (d[p] + d[p + 1] + d[p + 2]) / 3;
        min = Math.min(min, lum);
        max = Math.max(max, lum);
        sum += lum;
      }
      const range = max - min;
      // A region holding real artwork has a wide luminance range; an empty
      // region is flat card background.
      return `${name}: range=${range.toFixed(0)} avg=${(sum / (d.length / 4)).toFixed(0)} ${
        range > 40 ? "PRESENT ✓" : "MISSING ✗"
      }`;
    });
    setReport(lines.join("\n"));
  }, []);

  // Export as soon as the gate opens — the whole point is to prove that `ready`
  // is a sufficient condition for a complete render.
  useEffect(() => {
    if (ready) void run();
  }, [ready, run]);

  return (
    <div style={{ background: "#222", padding: 20, color: "#fff", fontFamily: "monospace" }}>
      <div id="status">{ready ? "READY" : "loading"}</div>
      <pre id="report" style={{ fontSize: 14, color: "#8f8" }}>
        {report || "…"}
      </pre>

      {/* The live card, at 40% for reference. */}
      <div style={{ width: CARD_W * 0.4, height: CARD_H * 0.4, overflow: "hidden" }}>
        <div style={{ transform: "scale(0.4)", transformOrigin: "top left" }}>
          <div ref={cardRef} style={{ width: CARD_W, height: CARD_H }}>
            <PnlCard data={DATA} metric="both" qrDataUrl={qr} logoSrc={logo} marketIconSrc={icon} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>EXPORTED PNG:</div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {png && <img src={png} alt="" style={{ width: CARD_W * 0.4 }} />}
    </div>
  );
}
