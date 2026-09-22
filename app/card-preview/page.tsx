"use client";

// TEMPORARY dev harness for eyeballing the share card without needing a funded
// wallet and an open position. Delete once the card's design is settled.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { PnlCard } from "@/components/share/PnlCard";
import { CARD_W, type PnlCardData, type ShareMetric } from "@/lib/share/pnlCard";

const BASE: PnlCardData = {
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

export default function CardPreviewPage() {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(BASE.referralUrl, {
      margin: 0,
      width: 220,
      color: { dark: "#08090c", light: "#ffffff" },
    }).then(setQr, () => setQr(null));
  }, []);

  const variants: { metric: ShareMetric; data: PnlCardData }[] = [
    { metric: "both", data: BASE },
    { metric: "pnl", data: BASE },
    { metric: "roi", data: { ...BASE, direction: "short", pnl: -812.4, roiPct: -63.2, closed: true } },
  ];

  const scale = 0.5;
  return (
    <div style={{ background: "#222", padding: 24, display: "flex", flexDirection: "column", gap: 24 }}>
      {variants.map((v, i) => (
        <div key={i} style={{ width: CARD_W * scale, overflow: "hidden" }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
            <PnlCard
              data={v.data}
              metric={v.metric}
              qrDataUrl={qr}
              marketIconSrc="/images/crypto/btc.png"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
