"use client";

import { useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  ArrowDownRight01Icon,
  ArrowDown01Icon,
  Share08Icon,
} from "@hugeicons/core-free-icons";
import { MARKETS } from "@/lib/markets";
import { formatPrice, formatUsd } from "@/lib/format";
import { Odometer } from "@/components/ui/Odometer";
import { useAllPositions, type LivePosition } from "@/hooks/useAllPositions";
import type { ShareSubject } from "@/components/share/ShareCardModal";

interface Props {
  /** Open the share card for a given position. */
  onShare: (subject: ShareSubject) => void;
}

// The right-panel positions view: an AGGREGATED Unrealized PnL across all markets,
// then one expandable row per open position. Direction shows as an up/down arrow
// (green/red), not "long/short". Each row can expand to full details and shares a
// PnL card.
export function PositionsPanel({ onShare }: Props) {
  const { items, totalPnl, totalRoiPct } = useAllPositions();
  const profit = totalPnl >= 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Aggregated Unrealized PnL (all markets). */}
      <div className="glass-inset rounded-2xl p-4">
        <div className="text-xs text-text-muted mb-1">Unrealized PnL</div>
        <div className={`text-2xl font-bold ${profit ? "text-up" : "text-down"}`}>
          <Odometer
            value={`${profit ? "+" : "−"}${formatUsd(Math.abs(totalPnl))}`}
          />
        </div>
        {items.length > 0 && (
          <div className={`text-xs font-semibold ${profit ? "text-up" : "text-down"}`}>
            <Odometer
              value={`${totalRoiPct >= 0 ? "+" : "−"}${Math.abs(totalRoiPct).toFixed(2)}%`}
            />
          </div>
        )}
      </div>

      {/* Open positions list. */}
      {items.length === 0 ? (
        <div className="glass-inset flex flex-1 items-center justify-center rounded-2xl p-4 text-center text-sm text-text-muted">
          No open positions
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Fixed label — stays put; only the rows below scroll. */}
          <div className="mb-2 shrink-0 px-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            Positions
          </div>
          <div className="scroll-glass flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-1 pr-1">
            {items.map((item) => (
              <PositionRow
                key={item.position.symbol}
                item={item}
                onShare={() =>
                  onShare({ kind: "position", position: item.position })
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PositionRow({
  item,
  onShare,
}: {
  item: LivePosition;
  onShare: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { position: pos, pnl, roiPct, markPrice } = item;
  const market = MARKETS[pos.symbol];
  const up = pos.direction === "long";
  const profit = pnl >= 0;

  return (
    <div className="glass-inset overflow-hidden rounded-2xl">
      {/* Collapsed header: icon · name · direction arrow · ROI · share. */}
      <div className="flex items-center gap-2.5 p-2.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2.5 text-left"
        >
          <Image
            src={market.logo}
            alt={market.label}
            width={36}
            height={36}
            className="h-8 w-8 rounded-full"
          />
          <div className="leading-tight">
            <div className="flex items-center gap-1.5 font-semibold">
              {pos.symbol}
              <HugeiconsIcon
                icon={up ? ArrowUpRight01Icon : ArrowDownRight01Icon}
                size={16}
                className={up ? "text-up" : "text-down"}
              />
            </div>
            <div className="text-[11px] text-text-muted">
              {market.label} · {pos.leverage}×
            </div>
          </div>
          <div className="ml-auto text-right leading-tight">
            <div
              className={`text-sm font-bold ${profit ? "text-up" : "text-down"}`}
            >
              <Odometer
                value={`${profit ? "+" : "−"}${Math.abs(roiPct).toFixed(1)}%`}
              />
            </div>
            <div className={`text-[11px] ${profit ? "text-up" : "text-down"}`}>
              <Odometer
                value={`${profit ? "+" : "−"}${formatUsd(Math.abs(pnl))}`}
              />
            </div>
          </div>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={16}
            className={`text-text-muted transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </button>
        <button
          type="button"
          onClick={onShare}
          className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          aria-label={`Share ${pos.symbol} position`}
        >
          <HugeiconsIcon icon={Share08Icon} size={18} />
        </button>
      </div>

      {/* Expanded details. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-1.5 border-t border-white/5 px-3 py-3 text-sm">
              <Detail
                label="Direction"
                value={`${up ? "Up" : "Down"} ${" "} / ${" "} ${pos.leverage}×`}
                color={up ? "up" : "down"}
              />
              <Detail
                label="ROI"
                value={`${profit ? "+" : "−"}${Math.abs(roiPct).toFixed(2)}%`}
                color={profit ? "up" : "down"}
              />
              <Detail label="Entry" value={`$${formatPrice(pos.entryPrice)}`} />
              <Detail
                label="Current"
                value={markPrice != null ? `$${formatPrice(markPrice)}` : "—"}
              />
              <Detail
                label="Liquidation"
                value={`$${formatPrice(pos.liquidationPrice)}`}
                color="down"
              />
              <Detail label="Margin" value={formatUsd(pos.marginUsed)} />
              {pos.trailActive && pos.trailStopPrice != null && (
                <Detail
                  label="Trail stop"
                  value={`$${formatPrice(pos.trailStopPrice)}`}
                  color="up"
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Detail({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "up" | "down";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span
        className={`font-semibold ${
          color === "up" ? "text-up" : color === "down" ? "text-down" : "text-text"
        }`}
      >
        <Odometer value={value} />
      </span>
    </div>
  );
}
