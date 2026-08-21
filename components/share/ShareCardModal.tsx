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
import {
  listMascots,
  type Mascot,
  type MascotOutcome,
} from "@/lib/share/mascots";
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
    mascot: null,
  });
  // Mascots available for THIS result (win vs loss), plus the picked one. The
  // picked id is remembered per outcome so flipping between a winning and a
  // losing subject doesn't reset the other side's choice.
  // `null` = discovery hasn't resolved yet; `[]` = it resolved and found none.
  // The distinction matters: an empty array must open the reveal gate, but a
  // pending discovery must hold it shut.
  const [mascots, setMascots] = useState<Mascot[] | null>(null);
  const [mascotId, setMascotId] = useState<string | null>(null);
  // Reveal is gated on TWO independent chains, tracked separately because they
  // resolve at very different speeds: the static assets load in parallel, while
  // the mascot needs a sequential folder probe *then* its bitmap. Deriving
  // `ready` from both is what stops the card appearing mascot-less and having
  // the artwork pop in a moment later.
  const [staticReady, setStaticReady] = useState(false);
  const [mascotReady, setMascotReady] = useState(false);
  const ready = staticReady && mascotReady;

  const symbol: MarketSymbol =
    subject.kind === "position" ? subject.position.symbol : subject.trade.symbol;
  const isOpen = subject.kind === "position";
  const referralUrl = useMemo(() => referralLink(), []);

  // Live mark price (only meaningful for an open position). Selecting the symbol's
  // primitive keeps redraws cheap and truthful.
  const livePrice = useAppSelector((s) => s.price.prices[symbol]);

  // Which mascot set to offer. Derived from the same PnL the card prints, so a
  // position that flips green→red mid-stream swaps to the losing mascots.
  const pnlNow =
    subject.kind === "trade" ? subject.trade.pnl : subject.position.unrealizedPnl;
  const outcome: MascotOutcome = pnlNow >= 0 ? "win" : "lose";

  // Load the (static) assets once: brand logo, market icon, QR of the ref link.
  // This opens only half the gate — the mascot chain below opens the other half.
  useEffect(() => {
    let alive = true;
    setStaticReady(false);
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
      setAssets((prev) => ({ ...prev, logo, marketIcon, qr }));
      // One more frame so the freshly-loaded fonts are ready to paint, then reveal.
      requestAnimationFrame(() => {
        if (alive) setStaticReady(true);
      });
    })();
    return () => {
      alive = false;
    };
  }, [symbol, referralUrl]);

  // Discover the mascots for this outcome and default to the first one. Files
  // are probed once per outcome and cached, so reopening the modal is instant.
  useEffect(() => {
    let alive = true;
    // A new outcome means a different mascot set — drop back to "pending" and
    // close the gate until the replacement artwork is actually decoded.
    setMascots(null);
    setMascotReady(false);
    listMascots(outcome).then((list) => {
      if (!alive) return;
      setMascots(list);
      // Keep the current pick if it belongs to this outcome; otherwise default
      // to the first mascot (or nothing at all if the folder is empty).
      setMascotId((cur) =>
        cur && list.some((m) => m.id === cur) ? cur : (list[0]?.id ?? null)
      );
    });
    return () => {
      alive = false;
    };
  }, [outcome]);

  // Load the picked mascot's bitmap for the canvas.
  useEffect(() => {
    let alive = true;
    const picked = mascots?.find((m) => m.id === mascotId);
    if (!picked) {
      setAssets((prev) => (prev.mascot ? { ...prev, mascot: null } : prev));
      // Open the gate only once discovery has actually finished and come back
      // empty — otherwise there is genuinely nothing to wait for. While it's
      // still pending (null), hold, or we'd reveal a mascot-less card again.
      setMascotReady(mascots !== null && mascots.length === 0);
      return;
    }
    // Swapping mascots re-closes the gate so the canvas never shows a stale
    // pick next to the new selection.
    setMascotReady(false);
    loadImage(picked.src).then((mascot) => {
      if (!alive) return;
      setAssets((prev) => ({ ...prev, mascot }));
      // `decode()` guarantees the bitmap is paint-ready, not merely fetched;
      // without it the first drawImage can still land on an undecoded frame.
      const reveal = () => {
        if (alive) setMascotReady(true);
      };
      if (mascot) {
        mascot.decode().then(reveal, reveal);
      } else {
        // Load failed — don't strand the user on a spinner over artwork.
        reveal();
      }
    });
    return () => {
      alive = false;
    };
  }, [mascotId, mascots]);

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

        {/* Mascot picker — sits directly under the card. Scrolls horizontally so
            the strip stays one row no matter how many artworks get dropped into
            /public/images/pnl-card. Hidden entirely if there's only one (or
            none) to choose from. */}
        {mascots && mascots.length > 1 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {mascots.map((m) => {
              const active = m.id === mascotId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMascotId(m.id)}
                  aria-label={`Mascot ${m.index}`}
                  aria-pressed={active}
                  className={`relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border transition-colors ${
                    active
                      ? "border-up bg-white/10"
                      : "border-white/10 bg-white/[0.03] hover:border-white/25"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.src}
                    alt=""
                    className="h-full w-full object-contain p-1"
                  />
                </button>
              );
            })}
          </div>
        )}

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
