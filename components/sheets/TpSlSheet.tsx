"use client";

import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { Sheet } from "@/components/ui/Sheet";
import { useAllPositions } from "@/hooks/useAllPositions";
import {
  findStopLoss,
  findTakeProfit,
  findTrailingStop,
} from "@/lib/bulk/protection";
import { formatPrice, formatUsd } from "@/lib/format";
import {
  breakEvenPrice,
  bulkToChartSpace,
  chartLiquidationPrice,
  chartToBulkSpace,
  netBreakEvenPrice,
} from "@/lib/perp";
import { useAppSelector } from "@/store/hooks";
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
  // The TRADING mode (demo/live) — distinct from `mode` below, which is how the
  // user is expressing the level. Price-space translation depends on this one.
  const tradingMode = useAppSelector((s) => s.tradingMode.mode);
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
  //
  // Bulk stores triggers in its OWN price space, so they are translated into
  // chart space on the way in — otherwise reopening the sheet would show a
  // level ~0.05% away from where it was set, and re-saving would drift it again.
  useEffect(() => {
    if (!open || !item) return;
    const p = item.position;
    const toChart = (v: number | undefined) =>
      v == null ? null : bulkToChartSpace(tradingMode, p, v);
    setTp(toChart(findTakeProfit(p.protection)?.triggerPrice));
    setSl(toChart(findStopLoss(p.protection)?.triggerPrice));
    setSubmitting(false);
  }, [open, item?.position.symbol, tradingMode]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const trailingStop = findTrailingStop(pos.protection);
  const trailing = trailingStop != null;

  // The user sets levels against the CHART, whose Y axis is the MagicBlock
  // oracle — so the whole sheet works in chart space and converts once, at
  // submit. Entry, mark and liquidation are all Bulk-quoted, so each is
  // translated the same way the chart's own lines are.
  const entryChart = breakEvenPrice(tradingMode, pos);
  const markChart =
    item.markPrice ??
    bulkToChartSpace(tradingMode, pos, pos.markPriceBulk ?? pos.entryPrice);
  const liqChart = chartLiquidationPrice(tradingMode, pos);
  // Where a stop closes for zero net — entry plus the fees already paid and the
  // exit fee still to come. Only offered once price is past it, since a stop
  // there would otherwise sit on the wrong side of the mark.
  const beChart = netBreakEvenPrice(tradingMode, pos) ?? entryChart;
  const canBreakEven =
    pos.direction === "long" ? markChart > beChart : markChart < beChart;

  const tpError = tp
    ? validateTrigger({
        side: "tp",
        direction: pos.direction,
        entryPrice: entryChart,
        markPrice: markChart,
        liquidationPrice: liqChart,
        triggerPrice: tp,
      })
    : null;
  const slError = sl
    ? validateTrigger({
        side: "sl",
        direction: pos.direction,
        entryPrice: entryChart,
        markPrice: markChart,
        liquidationPrice: liqChart,
        triggerPrice: sl,
      })
    : null;

  const blocked = tpError != null || slError != null;

  const submit = async () => {
    if (submitting || blocked || !symbol) return;
    playSound("tap");
    haptic("tap");
    setSubmitting(true);
    // THE conversion. Everything above is a chart (MagicBlock) price, because
    // that is the axis the user read the level off. Bulk evaluates the resting
    // trigger against its own feed, which sits a measured distance away, so the
    // level is translated exactly once — here, at the boundary.
    const toBulk = (v: number | null) =>
      v == null ? null : chartToBulkSpace(tradingMode, pos, v);
    const ok = await onSubmit({
      symbol,
      takeProfit: toBulk(tp),
      stopLoss: toBulk(sl),
    });
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
            Entry ${formatPrice(entryChart)}
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
          entryChart={entryChart}
          value={tp}
          onChange={setTp}
          error={tpError}
        />

        <TriggerEditor
          side="sl"
          label="Stop loss"
          mode={mode}
          item={item}
          entryChart={entryChart}
          value={sl}
          onChange={setSl}
          error={slError}
          onBreakEven={canBreakEven ? () => setSl(beChart) : undefined}
        />

        {/* A trailing stop rests ALONGSIDE a fixed one — Bulk allows both, and
            whichever level price reaches first fires. Worth saying, because two
            downside exits at once is easy to set by accident. */}
        {trailing && (
          <p className="-mt-1 px-1 text-[11px] leading-snug text-text-muted">
            A trailing stop is also active
            {trailingStop != null
              ? `, currently $${formatPrice(bulkToChartSpace(tradingMode, pos, trailingStop.triggerPrice))}`
              : ""}
            . Whichever level price reaches first will close this position.
          </p>
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
 * A numeric field that does not fight the person typing in it.
 *
 * The problem this solves: a controlled input whose value is
 * `number.toFixed(dp)` reformats on EVERY keystroke. Type "9" into a 3-decimal
 * market and the field instantly becomes "9.000" with the caret after the
 * zeros, so the next "9" lands as "9.0009" → "9.001". The number appeared to
 * creep by 0.001 per press.
 *
 * So while the field has focus, the user's own text is what is shown, verbatim
 * — including half-finished input like "9." or "-" that no number can
 * represent. The parsed value still flows out on every change, so the estimate
 * and the other field stay live. Formatting is applied only on blur, and an
 * external change (mode switch, Clear, a fresh position) re-syncs the text as
 * long as the user is not mid-edit.
 */
function NumericField({
  label,
  value,
  decimals,
  onChange,
  onCommit,
}: {
  label: string;
  value: number | null;
  /** Decimals used for the RESTING display; typing is never truncated. */
  decimals: number;
  onChange: (v: number | null) => void;
  /** Called on blur so the parent can normalize/clamp once editing ends. */
  onCommit?: () => void;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);

  const formatted = value == null ? "" : value.toFixed(decimals);

  // Follow the value when it changes from OUTSIDE (mode switch, Clear, seeding
  // from Bulk). Skipped while editing so it can never rewrite live input.
  useEffect(() => {
    if (!editing) setText(formatted);
  }, [formatted, editing]);

  return (
    <label className="flex-1">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-text-muted">
        {label}
      </span>
      <input
        inputMode="decimal"
        value={editing ? text : formatted}
        onFocus={() => {
          setEditing(true);
          setText(formatted);
        }}
        onBlur={() => {
          setEditing(false);
          onCommit?.();
        }}
        onChange={(e) => {
          // Accept only characters that can build a decimal number, so a stray
          // letter cannot wipe the field to null mid-word.
          const raw = e.target.value.replace(/[^0-9.\-]/g, "");
          setText(raw);
          if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
            return onChange(null);
          }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        placeholder="—"
        className="tabular w-full rounded-lg bg-white/[0.06] px-3 py-2.5 text-base font-semibold text-text outline-none placeholder:text-text-muted/50 focus:bg-white/[0.09]"
      />
    </label>
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
  entryChart,
  value,
  onChange,
  error,
  onBreakEven,
}: {
  side: TpSlSide;
  label: string;
  mode: InputMode;
  item: ReturnType<typeof useAllPositions>["items"][number];
  /** Entry in CHART space — every level here is a chart price. */
  entryChart: number;
  value: number | null;
  onChange: (v: number | null) => void;
  error: string | null;
  /** Moves the level to break-even; omitted when that is not a valid stop. */
  onBreakEven?: () => void;
}) {
  const pos = item.position;
  const isTp = side === "tp";
  // PnL/ROI are differences, so they are space-INDEPENDENT as long as the
  // trigger and the entry it is measured against share one space. Both are in
  // chart space here, which is also what the position panel's PnL uses.
  const basis = { ...pos, entryPrice: entryChart };

  // The level in the currently selected unit.
  const derived =
    value == null
      ? null
      : mode === "roi"
        ? roiAtPrice(basis, value)
        : mode === "change"
          ? changeAtPrice(entryChart, value)
          : pnlAtPrice(pos.direction, pos.size, entryChart, value);

  const applyDerived = (n: number | null) => {
    if (n == null) return onChange(null);
    onChange(
      mode === "roi"
        ? triggerFromRoi(basis, n)
        : mode === "change"
          ? triggerFromChange(entryChart, n)
          : triggerFromPnl(basis, n)
    );
  };

  const estPnl =
    value == null
      ? null
      : pnlAtPrice(pos.direction, pos.size, entryChart, value);
  const estRoi = value == null ? null : roiAtPrice(basis, value);

  return (
    <div className="glass-inset rounded-2xl p-4">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-sm font-semibold text-text">{label}</span>
        <div className="flex items-baseline gap-3">
          {onBreakEven && (
            <button
              type="button"
              onClick={() => {
                playSound("tap");
                haptic("tap");
                onBreakEven();
              }}
              className="text-[11px] font-semibold text-up transition-opacity hover:opacity-80"
            >
              B/E
            </button>
          )}
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
      </div>

      <div className="flex gap-2">
        <NumericField
          label="Trigger price"
          value={value}
          decimals={priceDp(entryChart)}
          onChange={onChange}
        />
        <div className="w-[38%]">
          <NumericField
            label={
              mode === "roi" ? "ROI %" : mode === "change" ? "Change %" : "P&L $"
            }
            value={derived}
            decimals={mode === "roi" ? 1 : 2}
            onChange={applyDerived}
          />
        </div>
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
