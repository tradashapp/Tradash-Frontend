"use client";

import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  ArrowDownRight01Icon,
  Share05Icon,
} from "@hugeicons/core-free-icons";
import { Sheet } from "@/components/ui/Sheet";
import { formatUsd } from "@/lib/format";
import { MARKETS } from "@/lib/markets";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { CompletedTrade } from "@/types";

interface Props {
  /** The trade to show; null keeps the sheet closed. */
  trade: CompletedTrade | null;
  onClose: () => void;
  /** Back to the trade history this was opened from. */
  onBack: () => void;
  /** Open the shareable PnL card for this trade. */
  onShare: (trade: CompletedTrade) => void;
}

const DASH = "—";

// One completed trade, opened from a row in the trade history. Read-only:
// everything here is already settled, so the only action is sharing it.
export function TradeDetailsSheet({ trade, onClose, onBack, onShare }: Props) {
  return (
    <Sheet open={trade !== null} onClose={onClose} onBack={onBack} title="Position details">
      {trade && <Details trade={trade} onShare={() => onShare(trade)} />}
    </Sheet>
  );
}

function Details({ trade, onShare }: { trade: CompletedTrade; onShare: () => void }) {
  // Bulk history can include markets the app doesn't list; fall back to the
  // bare symbol rather than failing to open.
  const market = MARKETS[trade.symbol] as (typeof MARKETS)[keyof typeof MARKETS] | undefined;
  const up = trade.direction === "long";
  const win = trade.pnl >= 0;
  const sign = win ? "+" : "−";

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex items-center gap-3">
        {market ? (
          <Image
            src={market.logo}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-full"
          />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
            {trade.symbol.slice(0, 1)}
          </span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-semibold">{market?.label ?? trade.symbol}</div>
          <div className="text-xs text-text-muted">
            {trade.symbol} · {fmtDate(trade.closedAt)}
          </div>
        </div>
      </div>

      <div className="glass-inset rounded-2xl p-4 text-center">
        <div className="text-[11px] text-text-muted">PnL</div>
        <div className={`tabular text-3xl font-bold ${win ? "text-up" : "text-down"}`}>
          {sign}
          {formatUsd(Math.abs(trade.pnl))}
        </div>
        <div className={`text-xs ${win ? "text-up" : "text-down"}`}>
          {sign}
          {Math.abs(trade.roi * 100).toFixed(2)}%
        </div>
        {trade.liquidated && (
          <span className="mt-2 inline-block rounded bg-down-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-down">
            Liquidated
          </span>
        )}
      </div>

      <div className="glass-inset divide-y divide-white/[0.06] rounded-2xl px-4">
        <Row label="Direction">
          <span className={`inline-flex items-center gap-1 ${up ? "text-up" : "text-down"}`}>
            <HugeiconsIcon icon={up ? ArrowUpRight01Icon : ArrowDownRight01Icon} size={14} />
            {up ? "Up" : "Down"}
          </span>
        </Row>
        <Row label="Leverage">{trade.leverage}×</Row>
        <Row label="Open price">{formatUsd(trade.entryPrice)}</Row>
        <Row label="Close price">{formatUsd(trade.exitPrice)}</Row>
        <Row label="Fees">{fmtFees(trade.fees)}</Row>
        <Row label="Take profit">{fmtLevel(trade.takeProfit)}</Row>
        <Row label="Stop loss">{fmtLevel(trade.stopLoss)}</Row>
      </div>

      <button
        type="button"
        onClick={() => {
          playSound("tap");
          haptic("tap");
          onShare();
        }}
        className="flex items-center justify-center gap-2 rounded-full bg-text py-3.5 text-sm font-bold text-black transition-transform active:scale-95"
      >
        <HugeiconsIcon icon={Share05Icon} size={16} />
        Share PnL
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className="tabular font-medium">{children}</span>
    </div>
  );
}

function fmtLevel(price: number | null | undefined): string {
  return price != null && price > 0 ? formatUsd(price) : DASH;
}

/** Fees are a cashflow (negative = paid); unknown on rows the app recorded itself. */
function fmtFees(fees: number | null | undefined): string {
  if (fees == null) return DASH;
  return fees > 0 ? `+${formatUsd(fees)}` : formatUsd(Math.abs(fees));
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
