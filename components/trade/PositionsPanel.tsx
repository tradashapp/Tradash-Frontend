"use client";

import { useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  ArrowDownRight01Icon,
  ArrowDown01Icon,
  Share05Icon,
  ChartCandlestickIcon,
  Loading03Icon,
  PlusSignIcon,
  MinusSignIcon,
  Cancel01Icon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { MARKETS } from "@/lib/markets";
import { effectiveStop, findTakeProfit, findTrailingStop } from "@/lib/protection";
import { formatPrice, formatUsd } from "@/lib/format";
import { Odometer } from "@/components/ui/Odometer";
import { useAllPositions, type LivePosition } from "@/hooks/useAllPositions";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { startSwitch, finishSwitch } from "@/store/slices/marketSlice";
import type { ShareSubject } from "@/components/share/ShareCardModal";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { MarketSymbol } from "@/types";

interface Props {
  /** Open the share card for a given position. */
  onShare: (subject: ShareSubject) => void;
  /** Called after navigating to a market's chart (e.g. to close the sheet). */
  onNavigate?: () => void;
  /** Close every open position at once. Omit to hide the "Close all" action. */
  onCloseAll?: () => void | Promise<void>;
  /**
   * Open the add/reduce sheet for one position. Omit to hide those actions
   * (the expanded row then keeps only Close).
   */
  onAdjust?: (item: LivePosition, mode: "add" | "reduce") => void;
  /** Close ONE position — the expanded row's own exit. */
  onClosePosition?: (item: LivePosition) => void | Promise<void>;
  /** Open the TP/SL sheet for one position. Omit to hide the TP/SL row. */
  onEditTpSl?: (item: LivePosition) => void;
}

// The right-panel positions view: an AGGREGATED Unrealized PnL across all markets,
// then one expandable row per open position. Direction shows as an up/down arrow
// (green/red), not "long/short". Each row can expand to full details and shares a
// PnL card.
export function PositionsPanel({
  onShare,
  onNavigate,
  onCloseAll,
  onAdjust,
  onClosePosition,
  onEditTpSl,
}: Props) {
  const { items, totalPnl, totalRoiPct } = useAllPositions();
  const dispatch = useAppDispatch();
  // TP/SL are real resting orders on Bulk, so the row is live-only: a demo
  // position has no account to rest them against.
  const isDemo = useAppSelector((s) => s.tradingMode.mode) === "demo";
  const [closingAll, setClosingAll] = useState(false);
  const profit = totalPnl >= 0;

  // Only worth offering when there's more than one position to close — with a
  // single one, the position's own close action already covers it.
  const canCloseAll = onCloseAll != null && items.length > 1;

  const doCloseAll = async () => {
    if (closingAll) return;
    playSound("tap");
    haptic("tap");
    setClosingAll(true);
    try {
      await onCloseAll?.();
    } finally {
      setClosingAll(false);
    }
  };

  // Jump straight to a market's chart (same dispatch the switcher uses).
  const goToMarket = (symbol: MarketSymbol) => {
    dispatch(startSwitch(symbol));
    requestAnimationFrame(() => dispatch(finishSwitch()));
    onNavigate?.();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Aggregated Unrealized PnL (all markets), with the bulk close action. */}
      <div className="glass-inset flex items-start gap-3 rounded-2xl p-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-text-muted mb-1">Unrealized PnL</div>
          <div
            className={`text-2xl font-bold ${profit ? "text-up" : "text-down"}`}
          >
            <Odometer
              value={`${profit ? "+" : "−"}${formatUsd(Math.abs(totalPnl))}`}
            />
          </div>
          {items.length > 0 && (
            <div
              className={`text-xs font-semibold ${profit ? "text-up" : "text-down"}`}
            >
              <Odometer
                value={`${totalRoiPct >= 0 ? "+" : "−"}${Math.abs(totalRoiPct).toFixed(2)}%`}
              />
            </div>
          )}
        </div>
        {canCloseAll && (
          <button
            type="button"
            onClick={doCloseAll}
            disabled={closingAll}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-down-soft px-3 py-1.5 text-xs font-semibold text-down transition-transform active:scale-95 disabled:opacity-50"
          >
            {closingAll && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="animate-spin"
              />
            )}
            {closingAll ? "Closing…" : `Close all (${items.length})`}
          </button>
        )}
      </div>

      {/* Open positions list. */}
      {items.length === 0 ? (
        <div className="glass-inset flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl p-4 text-center text-sm text-text-muted">
          <HugeiconsIcon
            icon={ChartCandlestickIcon}
            size={40}
            strokeWidth={1.5}
            className="text-text-muted/40"
          />
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
                onGoToMarket={() => goToMarket(item.position.symbol)}
                onAdjust={onAdjust}
                onClosePosition={onClosePosition}
                onEditTpSl={isDemo ? undefined : onEditTpSl}
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
  onGoToMarket,
  onAdjust,
  onClosePosition,
  onEditTpSl,
}: {
  item: LivePosition;
  onShare: () => void;
  onGoToMarket: () => void;
  onAdjust?: (item: LivePosition, mode: "add" | "reduce") => void;
  onClosePosition?: (item: LivePosition) => void | Promise<void>;
  onEditTpSl?: (item: LivePosition) => void;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const { position: pos, pnl, roiPct, markPrice } = item;
  const market = MARKETS[pos.symbol];
  const up = pos.direction === "long";
  const profit = pnl >= 0;
  // Resting protection, as Bulk reports it. A trailing stop fills the same
  // downside slot as a fixed stop, so it is pulled out separately for its own
  // live readout below.
  const trailOrder = findTrailingStop(pos.protection);

  return (
    <div className="glass-inset overflow-hidden rounded-2xl">
      {/* Collapsed header. Tapping the row toggles expand; ONLY the symbol
          navigates to that market's chart. Symbol/share stop propagation so they
          don't also toggle. Row is a div (not a button) so it can nest buttons. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex cursor-pointer items-center gap-2.5 p-2.5 text-left"
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
            {/* Tappable symbol → opens that chart (cursor pointer, hover cue). */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onGoToMarket();
              }}
              className="cursor-pointer rounded transition-colors hover:text-up hover:underline"
              aria-label={`Open ${pos.symbol} chart`}
            >
              {pos.symbol}
            </button>
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShare();
          }}
          className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          aria-label={`Share ${pos.symbol} position`}
        >
          <HugeiconsIcon icon={Share05Icon} size={18} />
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
              {/* Where closing gets out even once fees + funding are covered.
                  Sits next to Entry deliberately: the gap between the two IS
                  what the position has cost so far. */}
              {item.netBreakEven != null && (
                <Detail
                  label="Break-even"
                  value={`$${formatPrice(item.netBreakEven)}`}
                />
              )}
              {/* 0 is the "unknown" sentinel, not a price. Phoenix computes
                  this from margin inputs and returns nothing when a position
                  cannot be liquidated at any price; "$0.00" would read as
                  imminent liquidation instead of as no risk. */}
              <Detail
                label="Liquidation"
                value={
                  pos.liquidationPrice > 0
                    ? `$${formatPrice(pos.liquidationPrice)}`
                    : "—"
                }
                color="down"
              />
              <Detail label="Margin" value={formatUsd(pos.marginUsed)} />

              {/* TP/SL sits directly under Margin: it is the other half of the
                  risk picture the numbers above describe. Both levels read as
                  one line because they are one decision — where this position
                  gets out, in either direction. */}
              {onEditTpSl && (
                <TpSlRow item={item} onEdit={() => onEditTpSl(item)} />
              )}

              {/* A trailing stop's live level, once Bulk reports it. Shown
                  separately from TP/SL because it MOVES — it is a readout, not
                  a setting. */}
              {trailOrder && (
                <Detail
                  label="Trail stop"
                  value={`$${formatPrice(trailOrder.triggerPrice)}`}
                  color="up"
                />
              )}

              {/* Actions sit UNDER the numbers they change: Entry, Margin and
                  Liquidation are all directly above, so the effect of an add
                  or a reduce is read in the same glance as the action. */}
              {(onAdjust || onClosePosition) && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {onAdjust && (
                    <button
                      type="button"
                      onClick={() => {
                        playSound("tap");
                        haptic("tap");
                        onAdjust(item, "add");
                      }}
                      className="flex items-center justify-center gap-1 rounded-full bg-up-soft py-2.5 text-xs font-semibold text-up transition-transform active:scale-95"
                    >
                      <HugeiconsIcon icon={PlusSignIcon} size={15} />
                      Add
                    </button>
                  )}
                  {onAdjust && (
                    <button
                      type="button"
                      onClick={() => {
                        playSound("tap");
                        haptic("tap");
                        onAdjust(item, "reduce");
                      }}
                      className="flex items-center justify-center gap-1 rounded-full bg-white/[0.07] py-2.5 text-xs font-semibold text-text transition-transform active:scale-95 hover:bg-white/10"
                    >
                      <HugeiconsIcon icon={MinusSignIcon} size={15} />
                      Reduce
                    </button>
                  )}
                  {/* {onClosePosition && (
                    <button
                      type="button"
                      disabled={closing}
                      onClick={async () => {
                        if (closing) return;
                        playSound("tap");
                        haptic("tap");
                        setClosing(true);
                        try {
                          await onClosePosition(item);
                        } finally {
                          setClosing(false);
                        }
                      }}
                      className="flex items-center justify-center gap-1 rounded-full bg-down-soft py-2.5 text-xs font-semibold text-down transition-transform active:scale-95 disabled:opacity-50"
                    >
                      {closing ? (
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          size={15}
                          className="animate-spin"
                        />
                      ) : (
                        <HugeiconsIcon icon={Cancel01Icon} size={15} />
                      )}
                      {closing ? "Closing" : "Close"}
                    </button>
                  )} */}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The TP/SL line: both levels, or a dash where one is unset, with the whole row
 * tappable to edit.
 *
 * Renders ONLY what Bulk has confirmed is resting (`position.protection`) — not
 * what was last submitted. A trigger can be acknowledged and then silently
 * discarded (see lib/bulk/protection.ts), so showing local intent here would
 * tell the user they are protected when they may not be.
 */
function TpSlRow({
  item,
  onEdit,
}: {
  item: LivePosition;
  onEdit: () => void;
}) {
  const { protection } = item.position;
  const tp = findTakeProfit(protection);
  // The level that actually protects the downside: a trail and a fixed stop can
  // both rest, and whichever price reaches first wins — so the row shows that
  // one rather than arbitrarily preferring either.
  const sl = effectiveStop(protection, item.position.direction);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        playSound("tap");
        haptic("tap");
        onEdit();
      }}
      className="-mx-1 flex items-center justify-between rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-white/[0.04]"
    >
      <span className="text-text-muted">TP/SL</span>
      <span className="flex items-center gap-1.5">
        <span className="tabular font-semibold">
          <span className={tp ? "text-up" : "text-text-muted"}>
            {tp ? formatPrice(tp.triggerPrice) : "—"}
          </span>
          <span className="text-text-muted"> / </span>
          <span className={sl ? "text-down" : "text-text-muted"}>
            {sl ? formatPrice(sl.triggerPrice) : "—"}
          </span>
          {sl?.kind === "trailing" && (
            <span className="ml-1 text-[10px] text-text-muted">trail</span>
          )}
        </span>
        <HugeiconsIcon
          icon={PencilEdit02Icon}
          size={14}
          className="text-text-muted"
        />
      </span>
    </button>
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
