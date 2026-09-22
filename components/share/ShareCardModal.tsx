"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { toPng } from "html-to-image";
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
  ensureCardFonts,
  type PnlCardData,
  type ShareMetric,
} from "@/lib/share/pnlCard";
import { PnlCardPreview } from "./PnlCard";
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
  // The card is now real DOM rather than a canvas: `cardRef` is the node
  // html-to-image serializes for the PNG, `boxRef` the responsive wrapper whose
  // width decides how far down the full-size card is scaled for the preview.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const [metric, setMetric] = useState<ShareMetric>("both");
  // The card's three bitmaps, all held as data URLs. html-to-image clones the
  // node into an SVG <foreignObject>, which cannot reach back out to the origin
  // for an `/images/...` src — a plain path renders as a blank box in the export
  // even though the preview shows it fine. Inlining them up front makes the
  // export deterministic instead of racing html-to-image's own fetch pass.
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>();
  const [iconDataUrl, setIconDataUrl] = useState<string | undefined>();
  // Reveal gate. With the mascot gone there's only one chain left to wait on:
  // the QR bitmap + the card's web fonts. (The mascot used to need a sequential
  // folder probe of its own, which is why this was two flags.)
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);

  const symbol: MarketSymbol =
    subject.kind === "position" ? subject.position.symbol : subject.trade.symbol;
  const isOpen = subject.kind === "position";
  const referralUrl = useMemo(() => referralLink(), []);

  // Live mark price (only meaningful for an open position). Selecting the symbol's
  // primitive keeps redraws cheap and truthful.
  const livePrice = useAppSelector((s) => s.price.prices[symbol]);

  // Scale the full-size card into whatever width the modal gives it. Measured
  // rather than assumed: the modal is `max-w-2xl` but narrower on a phone, and
  // the card's layout is written in absolute pixels against CARD_W.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setScale(box.clientWidth / CARD_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // Load what the card needs before revealing it: the referral QR, the brand
  // mark, the market icon (all as data URLs — see above) and the card's fonts.
  useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      const [qr, logo, icon] = await Promise.all([
        QRCode.toDataURL(referralUrl, {
          margin: 0,
          width: 220,
          color: { dark: "#08090c", light: "#ffffff" },
        }).catch(() => null),
        toDataUrl("/icon-512.png"),
        toDataUrl(MARKETS[symbol].logo),
        // Prime the fonts the card names, so the first paint (and the export)
        // land in Space Grotesk / JetBrains Mono rather than a system fallback.
        ensureCardFonts(),
      ]);
      if (!alive) return;
      setQrDataUrl(qr);
      setLogoDataUrl(logo);
      setIconDataUrl(icon);
      // One more frame so the freshly-loaded fonts are ready to paint.
      requestAnimationFrame(() => {
        if (alive) setReady(true);
      });
    })();
    return () => {
      alive = false;
    };
  }, [referralUrl, symbol]);

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

  // Rasterize the card node to a PNG data URL.
  //
  // html-to-image clones the node into an SVG <foreignObject>, so it renders at
  // whatever size the node reports — CARD_W×CARD_H, independent of the preview's
  // transform, which lives on the parent. `pixelRatio: 1` pins it there rather
  // than multiplying by the device's DPR, which would make the exported file a
  // different size on a phone than on a desktop.
  const snapshot = useCallback(async (): Promise<string | null> => {
    const node = cardRef.current;
    if (!node) return null;
    try {
      return await toPng(node, {
        width: CARD_W,
        height: CARD_H,
        pixelRatio: 1,
        // The clone is rendered detached from the page, where the modal's own
        // transform/opacity would otherwise bleed in.
        style: { transform: "none", opacity: "1" },
      });
    } catch {
      return null;
    }
  }, []);

  const download = useCallback(async () => {
    if (!ready || exporting) return;
    setExporting(true);
    const url = await snapshot();
    setExporting(false);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradash-${data.symbol.toLowerCase()}-${
      data.pnl >= 0 ? "profit" : "loss"
    }.png`;
    a.click();
  }, [ready, exporting, snapshot, data.symbol, data.pnl]);

  // Share on X: X's web intent only carries text + a link (it can't attach a
  // local image), so we download the card first for the user to attach, then
  // open the composer pre-filled with a short, human caption + the ref link.
  const shareOnX = async () => {
    if (!ready || exporting) return;
    await download();
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
        // The card is vertically centred, so both insets are subtracted from
        // its height budget rather than padded onto it: at a flat 92dvh an
        // installed PWA left only ~4% of the screen above the card — less than
        // the status-bar inset — so a tall share card slid under the clock. Both
        // insets report 0 in a browser, where this stays the original 92dvh.
        className="glass relative z-10 flex max-h-[calc(92dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-2xl flex-col gap-4 rounded-3xl p-5"
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

        {/* Fixed-ratio (landscape) card preview. The card is real DOM rendered
            at CARD_W×CARD_H and scaled to fit this box — the shared image is
            always the same rectangle. Hidden until the QR and fonts are in. */}
        <div
          ref={boxRef}
          className="relative overflow-hidden rounded-2xl border border-white/10"
          style={{ aspectRatio: `${CARD_W} / ${CARD_H}` }}
        >
          <div
            className={`transition-opacity duration-200 ${
              ready && scale > 0 ? "opacity-100" : "opacity-0"
            }`}
          >
            {scale > 0 && (
              <PnlCardPreview
                cardRef={cardRef}
                scale={scale}
                data={data}
                metric={metric}
                qrDataUrl={qrDataUrl}
                logoSrc={logoDataUrl}
                marketIconSrc={iconDataUrl}
              />
            )}
          </div>
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-elevated/40">
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-up" />
            </div>
          )}
        </div>

        {/* The mascot picker lived here. Parked while the card's right-hand side
            is a gradient instead of artwork — restore this block (and the mascot
            loading in `lib/share/mascots.ts`) to bring the mascots back. */}

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
            disabled={!ready || exporting}
            className="flex items-center justify-center gap-2 rounded-xl bg-white/10 py-3 text-sm font-bold text-text transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <HugeiconsIcon icon={Download04Icon} size={18} />
            {!ready ? "Preparing…" : exporting ? "Saving…" : "Download"}
          </button>
          <button
            type="button"
            onClick={shareOnX}
            disabled={!ready || exporting}
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

/** Fetch a same-origin image and hand it back as a data URL, or undefined if it
 *  can't be read — the card just renders without that bitmap. */
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
