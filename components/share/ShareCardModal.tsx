"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  Download04Icon,
  NewTwitterIcon,
} from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { MARKETS } from "@/lib/markets";
import { referralLink } from "@/lib/config";
import { roi as roiOf } from "@/lib/perp";
import {
  CARD_W,
  CARD_H,
  drawPnlCard,
  ensureCardFonts,
  loadImage,
  type CardAssets,
  type PnlCardData,
  type ShareMetric,
} from "@/lib/share/pnlCard";
import type { CompletedTrade, MarketSymbol, Position } from "@/types";

// What we can share: a live/open position (mark price streams) or a completed
// trade (frozen at its exit price).
export type ShareSubject =
  | { kind: "position"; position: Position }
  | { kind: "trade"; trade: CompletedTrade };

interface Props {
  subject: ShareSubject | null;
  onClose: () => void;
}

const METRICS: { key: ShareMetric; label: string }[] = [
  { key: "pnl", label: "PnL" },
  { key: "roi", label: "ROI" },
  { key: "both", label: "Both" },
];

export function ShareCardModal({ subject, onClose }: Props) {
  return (
    <AnimatePresence>
      {subject && <ShareCardInner subject={subject} onClose={onClose} />}
    </AnimatePresence>
  );
}

function ShareCardInner({
  subject,
  onClose,
}: {
  subject: ShareSubject;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [metric, setMetric] = useState<ShareMetric>("both");
  const [assets, setAssets] = useState<CardAssets>({
    logo: null,
    marketIcon: null,
    qr: null,
  });
  // Only reveal the card / enable download once EVERY asset has resolved, so a
  // partial (missing logo/icon/QR) card can never be shown or exported.
  const [ready, setReady] = useState(false);

  const symbol: MarketSymbol =
    subject.kind === "position" ? subject.position.symbol : subject.trade.symbol;
  const isOpen = subject.kind === "position";
  const referralUrl = useMemo(() => referralLink(), []);

  // Live mark price (only meaningful for an open position). Selecting the symbol's
  // primitive keeps redraws cheap and truthful.
  const livePrice = useAppSelector((s) => s.price.prices[symbol]);

  // Load the (static) assets once: brand logo, market icon, QR of the ref link.
  // Mark ready ONLY after all three settle, so we never draw/export a partial card.
  useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      const [logo, marketIcon, qrUrl] = await Promise.all([
        loadImage("/icon-512.png"),
        loadImage(MARKETS[symbol].logo),
        QRCode.toDataURL(referralUrl, {
          margin: 0,
          width: 220,
          color: { dark: "#08090c", light: "#ffffff" },
        }).catch(() => null),
        // Prime the card's web fonts so canvas text renders in Space Grotesk /
        // JetBrains Mono rather than a system fallback.
        ensureCardFonts(),
      ]);
      const qr = qrUrl ? await loadImage(qrUrl) : null;
      if (!alive) return;
      setAssets({ logo, marketIcon, qr });
      // One more frame so the freshly-loaded fonts are ready to paint, then reveal.
      requestAnimationFrame(() => {
        if (alive) setReady(true);
      });
    })();
    return () => {
      alive = false;
    };
  }, [symbol, referralUrl]);

  // Assemble the card data, refreshing mark/PnL live for open positions.
  const data: PnlCardData = useMemo(() => {
    const market = MARKETS[symbol];
    if (subject.kind === "trade") {
      const t = subject.trade;
      return {
        symbol: t.symbol,
        marketLabel: market.label,
        direction: t.direction,
        leverage: t.leverage,
        pnl: t.pnl,
        roiPct: t.roi * 100,
        entryPrice: t.entryPrice,
        markPrice: t.exitPrice,
        closed: true,
        referralUrl,
      };
    }
    const p = subject.position;
    // p.unrealizedPnl is already the live display PnL (set by useAllPositions).
    return {
      symbol: p.symbol,
      marketLabel: market.label,
      direction: p.direction,
      leverage: p.leverage,
      pnl: p.unrealizedPnl,
      roiPct: roiOf(p.unrealizedPnl, p.marginUsed) * 100,
      entryPrice: p.entryPrice,
      markPrice: livePrice ?? p.entryPrice,
      closed: false,
      referralUrl,
    };
  }, [subject, symbol, livePrice, referralUrl]);

  // Redraw whenever data / metric / assets change — but only once assets are in.
  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawPnlCard(ctx, data, assets, metric);
  }, [ready, data, assets, metric]);

  const download = () => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradash-${data.symbol.toLowerCase()}-${
      data.pnl >= 0 ? "profit" : "loss"
    }.png`;
    a.click();
  };

  // Share on X: X's web intent only carries text + a link (it can't attach a
  // local image), so we download the card first for the user to attach, then
  // open the composer pre-filled with a short, human caption + the ref link.
  const shareOnX = () => {
    if (!ready) return;
    download();
    const text = tweetText(data);
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      text
    )}&url=${encodeURIComponent(data.referralUrl)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <motion.div
        className="glass relative z-10 flex max-h-[92dvh] w-full max-w-2xl flex-col gap-4 rounded-3xl p-5"
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8, opacity: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">
            Share {isOpen ? "position" : "trade"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-text"
            aria-label="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={20} />
          </button>
        </div>

        {/* Fixed-ratio (landscape) card preview. The canvas renders at
            CARD_W×CARD_H and is scaled to fit — the shared image is always the
            same rectangle. Hidden until every asset has loaded. */}
        <div
          className="relative overflow-hidden rounded-2xl border border-white/10"
          style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}
        >
          <canvas
            ref={canvasRef}
            width={CARD_W}
            height={CARD_H}
            className={`block h-full w-full transition-opacity duration-200 ${
              ready ? "opacity-100" : "opacity-0"
            }`}
          />
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-elevated/40">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-up" />
            </div>
          )}
        </div>

        {/* Metric toggle: PnL / ROI / Both. */}
        <div className="glass-inset flex rounded-xl p-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                metric === m.key
                  ? "bg-white/10 text-text"
                  : "text-text-muted hover:text-text"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={download}
            disabled={!ready}
            className="flex items-center justify-center gap-2 rounded-xl bg-white/10 py-3 text-sm font-bold text-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <HugeiconsIcon icon={Download04Icon} size={18} />
            {ready ? "Download" : "Preparing…"}
          </button>
          <button
            type="button"
            onClick={shareOnX}
            disabled={!ready}
            className="flex items-center justify-center gap-2 rounded-xl bg-up py-3 text-sm font-bold text-bg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <HugeiconsIcon icon={NewTwitterIcon} size={18} />
            Share on X
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// A short, human caption for the X composer — the way a trader actually posts a
// win or a loss. No hashtags, no filler, no "check out my trade on…". The card
// image (downloaded first) carries the details; this is just the one-liner.
function tweetText(data: PnlCardData): string {
  const dir = data.direction === "long" ? "long" : "short";
  const roiAbs = Math.abs(data.roiPct);
  const roiStr = `${data.roiPct >= 0 ? "+" : "-"}${roiAbs.toFixed(0)}%`;
  const pnlStr = `${data.pnl >= 0 ? "+" : "-"}$${Math.abs(data.pnl).toLocaleString(
    undefined,
    { maximumFractionDigits: 0 }
  )}`;

  if (data.pnl >= 0) {
    if (roiAbs >= 100) return `${roiStr} ${dir} on ${data.symbol}. let it ride 🚀`;
    if (roiAbs >= 25) return `${roiStr} on ${data.symbol} (${pnlStr}). green day`;
    return `${pnlStr} on ${data.symbol}. up only`;
  }
  // Loss — owning it, briefly.
  if (roiAbs >= 50) return `${roiStr} on ${data.symbol}. rough one, on to the next`;
  return `${pnlStr} on ${data.symbol}. taking the L, moving on`;
}
