"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { getFontEmbedCSS, toPng } from "html-to-image";
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
  const [qrDataUrl, setQrDataUrl] = useState<string | undefined>();
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>();
  const [iconDataUrl, setIconDataUrl] = useState<string | undefined>();
  // Reveal gate. With the mascot gone there's only one chain left to wait on:
  // the QR bitmap + the card's web fonts. (The mascot used to need a sequential
  // folder probe of its own, which is why this was two flags.)
  const [ready, setReady] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Set when a render comes back empty, so the failure is visible rather than
  // looking like a download that silently did nothing.
  const [failed, setFailed] = useState(false);

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
  //
  // Every bitmap is fetched AND decoded before `ready` flips. Gating on the
  // fetch alone was too weak: a data URL resolving only means the bytes are in a
  // string, not that the browser has a paintable bitmap — and the export clones
  // the live DOM, so an <img> that hasn't decoded yet can clone as an empty box.
  // That is a plausible path to "it said ready but an image was missing", though
  // the real defence is the pixel check on the export itself (`hasAllImages`),
  // since this gate alone can't prove what ended up in the PNG.
  useEffect(() => {
    let alive = true;
    setReady(false);
    (async () => {
      const [qr, logo, icon] = await Promise.all([
        cachedAsset(`qr:${referralUrl}`, () =>
          QRCode.toDataURL(referralUrl, {
            margin: 0,
            width: 220,
            color: { dark: "#08090c", light: "#ffffff" },
          }).catch(() => undefined)
        ),
        cachedAsset("logo", () => toDataUrl("/icon-512.png")),
        cachedAsset(`icon:${symbol}`, () => toDataUrl(MARKETS[symbol].logo)),
        // Prime the fonts the card names, so the first paint (and the export)
        // land in Space Grotesk / JetBrains Mono rather than a system fallback.
        ensureCardFonts(),
      ]);
      if (!alive) return;

      // Decode all three off-document before any of them is handed to the card.
      // `decode()` resolves only once the bitmap is ready to paint.
      await Promise.all([qr, logo, icon].map(decodeDataUrl));
      if (!alive) return;

      setQrDataUrl(qr);
      setLogoDataUrl(logo);
      setIconDataUrl(icon);

      // The srcs above are already-decoded data URLs, so the <img> tags the card
      // renders paint synchronously. Two frames: one for React to commit them,
      // one for the browser to paint that commit.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (alive) setReady(true);
        });
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
  //
  // It renders TWICE and keeps the second result. The first pass is a warm-up:
  // the library resolves the resources it embeds while building the clone, and a
  // first frame can come back before all of them have landed. Rather than trust
  // that, the result is VERIFIED below — the warm-up only makes the verification
  // pass on the first attempt instead of costing a retry.
  const snapshot = useCallback(async (): Promise<string | null> => {
    const node = cardRef.current;
    if (!node) return null;
    // Embedding the self-hosted next/font faces is the slowest part of a render
    // and the result never changes, so it's computed once per tab and handed
    // back in. Without this every export re-walks and re-downloads them.
    const fontEmbedCSS = await cachedFontCss(node);
    // The clone is rendered detached from the page, where the modal's own
    // transform/opacity would otherwise bleed in.
    const opts = {
      width: CARD_W,
      height: CARD_H,
      pixelRatio: 1,
      cacheBust: false,
      fontEmbedCSS,
      style: { transform: "none", opacity: "1" },
    };
    try {
      await toPng(node, opts); // warm-up, result deliberately discarded
      // Verify rather than assume. A PNG that came out short an image is still a
      // valid PNG, so the only honest check is to look at the pixels where the
      // images should be — which is exactly the failure being fixed here.
      for (let attempt = 0; attempt < 3; attempt++) {
        const url = await toPng(node, opts);
        if (await hasAllImages(url)) return url;
      }
      return null;
    } catch {
      return null;
    }
  }, []);

  const download = useCallback(async (): Promise<boolean> => {
    if (!ready || exporting) return false;
    setExporting(true);
    setFailed(false);
    const url = await snapshot();
    setExporting(false);
    // A failed render used to return silently, which looked identical to a
    // download that worked — the user only found out by opening the file.
    if (!url) {
      setFailed(true);
      return false;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = `tradash-${data.symbol.toLowerCase()}-${
      data.pnl >= 0 ? "profit" : "loss"
    }.png`;
    a.click();
    return true;
  }, [ready, exporting, snapshot, data.symbol, data.pnl]);

  // Share on X: X's web intent only carries text + a link (it can't attach a
  // local image), so we download the card first for the user to attach, then
  // open the composer pre-filled with a short, human caption + the ref link.
  const shareOnX = async () => {
    if (!ready || exporting) return;
    // Only open the composer if the user actually got the image — otherwise
    // they'd land on X with a caption and nothing to attach.
    if (!(await download())) return;
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
            {!ready
              ? "Preparing…"
              : exporting
                ? "Saving…"
                : failed
                  ? "Retry"
                  : "Download"}
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

// Where the card's three bitmaps land inside the CARD_W×CARD_H rectangle, as
// [x, y, w, h] boxes well inside each one. These mirror the layout in
// PnlCard.tsx — if the card's geometry moves, these move with it.
const IMAGE_REGIONS: [number, number, number, number][] = [
  [90, 90, 60, 60], // market icon (top-left, inside the 80px pad)
  [85, 855, 40, 40], // brand logo (footer, bottom-left)
  [1360, 800, 150, 150], // QR code (footer, bottom-right)
];

/**
 * Does this exported PNG actually contain all three images?
 *
 * A render that dropped one is still a structurally valid PNG, so the only way
 * to know is to look. Each region is checked for luminance VARIANCE: real
 * artwork spans a wide range, whereas a dropped image leaves flat card
 * background (or flat white, for the QR plate). Returns true if it can't check
 * at all — a browser that won't give us the pixels shouldn't block the download.
 */
async function hasAllImages(dataUrl: string): Promise<boolean> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return true;
    ctx.drawImage(img, 0, 0, CARD_W, CARD_H);

    return IMAGE_REGIONS.every(([x, y, w, h]) => {
      const { data } = ctx.getImageData(x, y, w, h);
      let min = 255;
      let max = 0;
      for (let p = 0; p < data.length; p += 4) {
        const lum = (data[p] + data[p + 1] + data[p + 2]) / 3;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
      }
      // Measured spread for the real artwork is 150–250; flat background is 0.
      return max - min > 40;
    });
  } catch {
    return true;
  }
}

// The embedded @font-face CSS, computed once per tab. This is the single most
// expensive part of a render (it walks the stylesheets and inlines the woff2
// payloads) and its output is identical every time.
let fontCssPromise: Promise<string | undefined> | null = null;

function cachedFontCss(node: HTMLElement): Promise<string | undefined> {
  fontCssPromise ??= getFontEmbedCSS(node).catch(() => undefined);
  return fontCssPromise;
}

// Data URLs, cached for the life of the tab and keyed by source path. The brand
// mark and the coin icons never change, and the QR only changes with the
// referral link — so the second open of the share sheet (and every one after)
// skips the fetch/encode entirely and reveals on the next frame. Promises are
// cached rather than results, so two opens in flight at once share one fetch.
const assetCache = new Map<string, Promise<string | undefined>>();

function cachedAsset(
  key: string,
  load: () => Promise<string | undefined>
): Promise<string | undefined> {
  let hit = assetCache.get(key);
  if (!hit) {
    // A failed load must not be cached as a permanent miss — drop it so the next
    // open retries rather than showing a card that is short an image forever.
    hit = load().then((v) => {
      if (v === undefined) assetCache.delete(key);
      return v;
    });
    assetCache.set(key, hit);
  }
  return hit;
}

/** Decode a data URL to a paintable bitmap, so the <img> that later carries it
 *  paints (and clones, for the export) on its very first frame. Resolves either
 *  way: a bitmap that won't decode must not strand the user on a spinner. */
async function decodeDataUrl(src: string | null | undefined): Promise<void> {
  if (!src) return;
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
  } catch {
    /* card renders without it rather than hanging */
  }
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
