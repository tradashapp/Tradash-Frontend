"use client";

import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { Sheet } from "@/components/ui/Sheet";
import { useAllPositions } from "@/hooks/useAllPositions";
import { findStopLoss, findTakeProfit } from "@/lib/bulk/protection";
import { formatPrice, formatUsd } from "@/lib/format";
import {
  changeAtPrice,
  pnlAtPrice,
  roiAtPrice,
  triggerFromChange,
  triggerFromPnl,
  triggerFromRoi,
  validateTrigger,
  type TpSlSide,
} from "@/lib/tpsl";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { MarketSymbol } from "@/types";

/**
 * Set the take-profit and stop-loss on an open position.
 *
 * Both sides are edited together and submitted once, because on Bulk they are
 * two resting orders against ONE position: applying them separately would mean
 * two round-trips and a window where half the intent is live.
 *
 * A level can be expressed three ways — ROI on margin, price change from entry,
 * or dollar P&L. They are three views of the same point, so the sheet keeps the
 * TRIGGER PRICE as the single source of truth and derives whichever the user is
 * looking at. Switching modes therefore never changes the level, only its
 * wording.
 *
 * The position is looked up live (by symbol) so the estimate tracks the real
 * mark while the sheet is open, rather than freezing at the price that happened
 * to be on screen when it was tapped.
 */

type InputMode = "roi" | "change" | "pnl";

const MODES: { id: InputMode; label: string; hint: string }[] = [
  { id: "roi", label: "ROI %", hint: "Return on the margin you put up" },
  { id: "change", label: "Change %", hint: "Move in the asset price from entry" },
  { id: "pnl", label: "P&L", hint: "Profit or loss in dollars" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Market being protected, or null while the sheet animates shut. */
  symbol: MarketSymbol | null;
  /** Applies both sides at once. Resolves false when nothing was changed. */
  onSubmit: (params: {
    symbol: MarketSymbol;
    takeProfit: number | null;
    stopLoss: number | null;
  }) => Promise<boolean>;
}

export function TpSlSheet({ open, onClose, symbol, onSubmit }: Props) {
  const { items } = useAllPositions();
  const item = useMemo(
    () => items.find((i) => i.position.symbol === symbol) ?? null,
    [items, symbol]
  );

  const [mode, setMode] = useState<InputMode>("roi");
  // Trigger prices are the source of truth; null = that side is unset.
  const [tp, setTp] = useState<number | null>(null);
  const [sl, setSl] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Seed from whatever is already resting on Bulk each time the sheet opens, so
  // it edits reality rather than starting blank over an armed position.
  useEffect(() => {
    if (!open || !item) return;
    const existingTp = findTakeProfit(item.position.protection);
    const existingSl = findStopLoss(item.position.protection);
    setTp(existingTp?.triggerPrice ?? null);
    setSl(existingSl?.triggerPrice ?? null);
    setSubmitting(false);
  }, [open, item?.position.symbol]); // eslint-disable-line react-hooks/exhaustive-deps

  // The position closed (or the sheet is animating shut) — keep the shell so the
  // exit animation still runs, but say why it is empty.
  if (!item) {
    return (
      <Sheet open={open} onClose={onClose} title="TP/SL">
        <p className="py-8 text-center text-sm text-text-muted">
          This position is no longer open.
        </p>
      </Sheet>
    );
  }

  const pos = item.position;
  const trailing = findStopLoss(pos.protection)?.kind === "trailing";

  const tpError = tp
    ? validateTrigger({
        side: "tp",
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        markPrice: pos.markPriceBulk,
        liquidationPrice: pos.liquidationPrice,
        triggerPrice: tp,
      })
    : null;
  const slError = sl
    ? validateTrigger({
        side: "sl",
        direction: pos.direction,
        entryPrice: pos.entryPrice,
        markPrice: pos.markPriceBulk,
        liquidationPrice: pos.liquidationPrice,
        triggerPrice: sl,
      })
    : null;

  const blocked = tpError != null || slError != null;

  const submit = async () => {
    if (submitting || blocked || !symbol) return;
    playSound("tap");
    haptic("tap");
    setSubmitting(true);
    const ok = await onSubmit({ symbol, takeProfit: tp, stopLoss: sl });
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="TP/SL">
      <div className="flex flex-col gap-4 pb-2">
        {/* Context: what is being protected. */}
        <div className="glass-inset flex items-center justify-between rounded-2xl px-4 py-3 text-sm">
          <span className="text-text-muted">
            {pos.symbol} · {pos.direction === "long" ? "Up" : "Down"}{" "}
            {pos.leverage}×
          </span>
          <span className="tabular font-semibold">
            Entry ${formatPrice(pos.entryPrice)}
          </span>
        </div>

        {/* How to express the levels. Switching never moves a level — it only
            re-words it — so the user can think in whichever unit they prefer. */}
        <div>
          <div className="mb-2 flex gap-1.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  playSound("tap");
                  haptic("tap");
                  setMode(m.id);
                }}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                  mode === m.id
                    ? "bg-white/[0.14] text-text"
                    : "bg-white/[0.05] text-text-muted hover:bg-white/10"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="px-1 text-[11px] text-text-muted">
            {MODES.find((m) => m.id === mode)?.hint}
          </p>
        </div>

        <TriggerEditor
          side="tp"
          label="Take profit"
          mode={mode}
          item={item}
          value={tp}
          onChange={setTp}
          error={tpError}
        />

        {/* A trailing stop occupies the same downside slot as a fixed stop, so
            editing one here would silently replace the other. Say so instead. */}
        {trailing ? (
          <div className="glass-inset rounded-2xl p-4 text-sm">
            <div className="mb-1 font-semibold text-text">Stop loss</div>
            <p className="text-[12px] leading-snug text-text-muted">
              A trailing stop is active on this position and already covers the
              downside. Turn it off to set a fixed stop loss instead.
            </p>
          </div>
        ) : (
          <TriggerEditor
            side="sl"
            label="Stop loss"
            mode={mode}
            item={item}
            value={sl}
            onChange={setSl}
            error={slError}
          />
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting || blocked}
          className="flex items-center justify-center gap-2 rounded-full bg-text py-3.5 text-sm font-bold text-black transition-transform active:scale-95 disabled:opacity-40"
        >
          {submitting && (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={16}
              className="animate-spin"
            />
          )}
          {submitting ? "Saving…" : "Confirm"}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * One side's editor: a trigger price, the same level in the chosen unit, and
 * what it would realize.
 *
 * Both inputs write the same underlying trigger price, so they cannot drift
 * apart — typing in either immediately re-derives the other.
 */
function TriggerEditor({
  side,
  label,
  mode,
  item,
  value,
  onChange,
  error,
}: {
  side: TpSlSide;
  label: string;
  mode: InputMode;
  item: ReturnType<typeof useAllPositions>["items"][number];
  value: number | null;
  onChange: (v: number | null) => void;
  error: string | null;
}) {
  const pos = item.position;
  const isTp = side === "tp";

  // The level in the currently selected unit.
  const derived =
    value == null
      ? ""
      : mode === "roi"
        ? roiAtPrice(pos, value).toFixed(1)
        : mode === "change"
          ? changeAtPrice(pos.entryPrice, value).toFixed(2)
          : pnlAtPrice(pos.direction, pos.size, pos.entryPrice, value).toFixed(2);

  const applyDerived = (raw: string) => {
    if (raw.trim() === "") return onChange(null);
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onChange(
      mode === "roi"
        ? triggerFromRoi(pos, n)
        : mode === "change"
          ? triggerFromChange(pos.entryPrice, n)
          : triggerFromPnl(pos, n)
    );
  };

  const estPnl =
    value == null
      ? null
      : pnlAtPrice(pos.direction, pos.size, pos.entryPrice, value);
  const estRoi = value == null ? null : roiAtPrice(pos, value);

  return (
    <div className="glass-inset rounded-2xl p-4">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-text">{label}</span>
        {value != null && (
          <button
            type="button"
            onClick={() => {
              playSound("tap");
              haptic("tap");
              onChange(null);
            }}
            className="text-[11px] text-text-muted transition-colors hover:text-text"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex gap-2">
        <label className="flex-1">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            Trigger price
          </span>
          <input
            inputMode="decimal"
            value={value == null ? "" : value.toFixed(priceDp(pos.entryPrice))}
            onChange={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") return onChange(null);
              const n = Number(raw);
              if (Number.isFinite(n)) onChange(n);
            }}
            placeholder="—"
            className="tabular w-full rounded-lg bg-white/[0.06] px-3 py-2.5 text-base font-semibold text-text outline-none placeholder:text-text-muted/50 focus:bg-white/[0.09]"
          />
        </label>
        <label className="w-[38%]">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
            {mode === "roi" ? "ROI %" : mode === "change" ? "Change %" : "P&L $"}
          </span>
          <input
            inputMode="decimal"
            value={derived}
            onChange={(e) => applyDerived(e.target.value)}
            placeholder="—"
            className="tabular w-full rounded-lg bg-white/[0.06] px-3 py-2.5 text-base font-semibold text-text outline-none placeholder:text-text-muted/50 focus:bg-white/[0.09]"
          />
        </label>
      </div>

      {error ? (
        <p className="mt-2 text-[11px] leading-snug text-down">{error}</p>
      ) : value != null && estPnl != null && estRoi != null ? (
        <p className="mt-2 text-[11px] leading-snug text-text-muted">
          Closes at ${formatPrice(value)} for{" "}
          <span
            className={`tabular font-semibold ${
              estPnl >= 0 ? "text-up" : "text-down"
            }`}
          >
            {estPnl >= 0 ? "+" : "−"}
            {formatUsd(Math.abs(estPnl))}
          </span>{" "}
          <span className={estPnl >= 0 ? "text-up" : "text-down"}>
            ({estRoi >= 0 ? "+" : "−"}
            {Math.abs(estRoi).toFixed(1)}%)
          </span>
        </p>
      ) : (
        <p className="mt-2 text-[11px] leading-snug text-text-muted">
          {isTp ? "Not set — no automatic exit in profit." : "Not set."}
        </p>
      )}
    </div>
  );
}

/** Decimals to show a trigger at, matched to the market's price scale. */
function priceDp(reference: number): number {
  if (reference >= 1000) return 2;
  if (reference >= 1) return 3;
  return 6;
}
