"use client";

import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";
import { Sheet } from "@/components/ui/Sheet";
import { useAppSelector } from "@/store/hooks";
import { MARGIN_HEADROOM } from "@/hooks/useTrade";
import { liquidationPrice } from "@/lib/perp";
import { formatPrice } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { useAllPositions } from "@/hooks/useAllPositions";
import type { MarketSymbol } from "@/types";

/**
 * Add to / reduce an OPEN position.
 *
 * Deliberately separate from MarketSettingsSheet. That sheet configures the
 * NEXT order and holds no draft state — a number changed there IS what gets
 * sent. This one mutates a position that already exists, so it does keep a
 * draft (the amount) until the user confirms. Merging the two would have made
 * the size slider mean two different things depending on whether the user
 * happens to hold the market.
 *
 * The amount is expressed in MARGIN, matching `increase`/`decrease` in
 * useTrade and the "Margin" row the position already shows. Notional is
 * displayed alongside, because at 20× the two differ by a factor that decides
 * whether the order is reasonable.
 */

/** Same floor useTrade enforces before submitting — mirrored so the button can
 *  disable rather than letting the order be rejected after the tap. */
const MIN_MARGIN_USD = 5;

/**
 * Cap on a reduce, as a fraction of the position's margin.
 *
 * A reduce is never allowed to reach 100%: at exactly the full size it is just
 * a close, and routing a close through the reduce path means the trail state
 * and the realized-PnL toast take the partial branch. The Close button is the
 * one way out, so the slider stops here and the 100% preset is absent.
 */
const MAX_REDUCE_FRACTION = 0.95;

export type AdjustMode = "add" | "reduce";

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * The market being adjusted, or null while the sheet animates shut.
   *
   * A SYMBOL rather than the row itself: the sheet looks the position up live,
   * so its mark price, PnL and margin keep ticking while the user drags the
   * slider. A frozen snapshot would quietly preview against a stale price.
   */
  symbol: MarketSymbol | null;
  mode: AdjustMode;
  /** useTrade.increase / useTrade.decrease — both take (usd, symbol). */
  onSubmit: (deltaUsd: number, symbol: MarketSymbol) => Promise<void> | void;
}

const usd2 = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function AdjustPositionSheet({
  open,
  onClose,
  symbol,
  mode,
  onSubmit,
}: Props) {
  const tradingMode = useAppSelector((s) => s.tradingMode.mode);
  const liveBalance = useAppSelector((s) => s.user.balance);
  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const [amount, setAmount] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // Live lookup, so the preview tracks the current mark rather than the price
  // that happened to be on screen when the row was tapped.
  const { items } = useAllPositions();
  const item = useMemo(
    () => items.find((i) => i.position.symbol === symbol) ?? null,
    [items, symbol]
  );

  const pos = item?.position ?? null;
  const isAdd = mode === "add";

  const available =
    tradingMode === "demo" ? demoBalance : liveBalance?.available ?? null;

  /**
   * The ceiling for the slider.
   *
   * Adding is bounded by free collateral with the SAME headroom `useTrade`
   * applies, so the slider cannot reach a number the order path would silently
   * trim. Reducing is bounded by the position's own margin, short of a full
   * exit.
   */
  const max = useMemo(() => {
    if (!pos) return 0;
    if (isAdd) {
      return available != null ? Math.max(available * MARGIN_HEADROOM, 0) : pos.marginUsed;
    }
    // The reduce cap has to be expressed in the SAME terms `decrease` uses.
    //
    // It converts the amount to a base size at the CURRENT mark
    // (`deltaUsd × leverage / mark`), while the position's margin was set at
    // its ENTRY price. Capping at 95% of margin therefore only means 95% of
    // size while the two prices agree: on a position down 20%, 95% of margin
    // converts to more than the whole position and the clamp in `decrease`
    // turns "Reduce" into a full close — the one thing this cap exists to
    // prevent. So cap on the size fraction and convert back.
    const maxSize = pos.size * MAX_REDUCE_FRACTION;
    const markNow = item?.markPrice ?? pos.entryPrice;
    const maxUsd =
      pos.leverage > 0 ? (maxSize * markNow) / pos.leverage : pos.marginUsed;
    return Math.max(Math.min(maxUsd, pos.marginUsed * MAX_REDUCE_FRACTION), 0);
  }, [pos, isAdd, available, item?.markPrice]);

  // Reset to a sane starting amount whenever the sheet opens or flips mode.
  // Half the allowed range is a more useful default than zero (which makes the
  // confirm button dead on arrival) or the max (which is a trap).
  // `max` is deliberately NOT a dependency: it moves with every price tick, and
  // re-seeding on each one would yank the slider out from under the user's
  // thumb. Seeding on open / mode / market only.
  useEffect(() => {
    if (!open || !symbol) return;
    setAmount(Number((max / 2).toFixed(2)));
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, symbol]);

  // The position can vanish underneath an open sheet — a close from elsewhere,
  // a trail firing, a liquidation. Say so rather than rendering a slider that
  // would submit an order against nothing.
  // Mark price for the preview. Falls back to entry so the memo below can run
  // even with no position — the hooks in this component must be unconditional.
  const markPrice = item?.markPrice ?? pos?.entryPrice ?? 0;
  const notional = amount * (pos?.leverage ?? 0);

  /**
   * What the position looks like AFTER the order fills.
   *
   * Adding blends the new size in at the current mark, so the entry moves
   * toward the mark and the liquidation price moves with it — that is the
   * number a user most needs before adding to a losing position, and it is the
   * whole reason this sheet confirms rather than firing on tap.
   *
   * Reducing leaves entry and liquidation untouched (the remaining size keeps
   * its basis) and instead realizes a slice of the open PnL.
   *
   * Computed BEFORE the "no longer open" early return: a hook may not sit
   * behind a conditional, or the hook order changes on the render where the
   * position disappears and React tears the component down.
   */
  const preview = useMemo(() => {
    if (!pos) return null;
    if (isAdd) {
      const addSize = markPrice > 0 ? (amount * pos.leverage) / markPrice : 0;
      const newSize = pos.size + addSize;
      if (newSize <= 0) return null;
      const newEntry =
        (pos.entryPrice * pos.size + markPrice * addSize) / newSize;
      return {
        entry: newEntry,
        liq: liquidationPrice(pos.direction, newEntry, pos.leverage),
        margin: pos.marginUsed + amount,
        realized: null as number | null,
      };
    }
    const fraction = pos.marginUsed > 0 ? amount / pos.marginUsed : 0;
    return {
      entry: pos.entryPrice,
      liq: pos.liquidationPrice,
      margin: Math.max(pos.marginUsed - amount, 0),
      realized: pos.unrealizedPnl * fraction,
    };
  }, [isAdd, amount, markPrice, pos]);

  if (!pos) {
    return (
      <Sheet open={open} onClose={onClose} title="Adjust position">
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <p className="text-sm text-text-muted">
            This position is no longer open.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white/[0.07] px-5 py-2.5 text-sm font-semibold text-text transition-transform active:scale-95 hover:bg-white/10"
          >
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  // Adding is blocked outright when there is nothing free to post — better to
  // say so than to let the slider imply room that isn't there.
  const noRoom = isAdd && max < MIN_MARGIN_USD;
  const tooSmall = amount < MIN_MARGIN_USD;
  const disabled = submitting || noRoom || tooSmall || amount <= 0;

  const confirm = async () => {
    if (disabled) return;
    playSound("tap");
    haptic("tap");
    setSubmitting(true);
    try {
      await onSubmit(amount, pos.symbol);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${isAdd ? "Add to" : "Reduce"} ${pos.symbol}`}
    >
      <div className="flex flex-col gap-3 pb-2">
        {/* ---- Amount -------------------------------------------------- */}
        <section className="glass-inset rounded-2xl p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              {isAdd ? "Margin to add" : "Margin to remove"}
            </span>
            <span className="tabular text-[11px] text-text-muted">
              {isAdd ? (
                available != null ? (
                  <>
                    <span className="text-text">{usd2(available)}</span>{" "}
                    available
                  </>
                ) : (
                  "—"
                )
              ) : (
                <>
                  <span className="text-text">{usd2(pos.marginUsed)}</span> in
                  position
                </>
              )}
            </span>
          </div>

          <div className="flex items-end justify-between gap-3">
            <span className="tabular text-3xl font-bold text-text">
              {usd2(amount)}
            </span>
            <span className="tabular pb-1.5 text-xs text-text-muted">
              {usd2(notional)} notional
            </span>
          </div>

          <input
            type="range"
            min={0}
            max={Math.max(max, 1)}
            step={0.01}
            value={Math.min(amount, max)}
            disabled={noRoom}
            onChange={(e) => setAmount(Number(e.target.value))}
            aria-label={isAdd ? "Margin to add" : "Margin to remove"}
            className="lev-slider mt-3 w-full disabled:opacity-40"
            style={{
              ["--fill" as string]: `${
                (Math.min(amount, max) / Math.max(max, 1)) * 100
              }%`,
            }}
          />

          {/* Reduce tops out below a full exit, so it offers no "Max" — the
              Close button is the only way to 100%. */}
          <div className="mt-2 flex items-center gap-2">
            {(isAdd ? [0.25, 0.5, 0.75, 1] : [0.25, 0.5, 0.75]).map((f) => {
              const target = max * f;
              const active = Math.abs(amount - target) < 0.005;
              return (
                <button
                  key={f}
                  type="button"
                  disabled={noRoom}
                  onClick={() => {
                    playSound("tap");
                    haptic("tap");
                    setAmount(Number(target.toFixed(2)));
                  }}
                  className={`tabular flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                    active
                      ? isAdd
                        ? "bg-up text-black"
                        : "bg-down text-black"
                      : "bg-white/[0.07] text-text-muted hover:bg-white/10"
                  }`}
                >
                  {f === 1 ? "Max" : `${f * 100}%`}
                </button>
              );
            })}
          </div>

          {noRoom && (
            <p className="mt-2 text-[11px] text-text-muted">
              Not enough free margin to add. Deposit more USDC.
            </p>
          )}
          {!noRoom && tooSmall && (
            <p className="mt-2 text-[11px] text-text-muted">
              Minimum {usd2(MIN_MARGIN_USD)} of margin.
            </p>
          )}
        </section>

        {/* ---- After this order ---------------------------------------- */}
        {/* The point of confirming rather than firing on tap: adding moves the
            entry and the liquidation price, and that has to be visible BEFORE
            the order goes out. */}
        {preview && !noRoom && (
          <section className="glass-inset rounded-2xl p-4">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">
              After this order
            </div>
            <div className="flex flex-col gap-1.5 text-sm">
              <Row
                label="Margin"
                from={usd2(pos.marginUsed)}
                to={usd2(preview.margin)}
              />
              {isAdd && (
                <Row
                  label="Entry"
                  from={`$${formatPrice(pos.entryPrice)}`}
                  to={`$${formatPrice(preview.entry)}`}
                />
              )}
              {isAdd && (
                <Row
                  label="Liquidation"
                  from={`$${formatPrice(pos.liquidationPrice)}`}
                  to={`$${formatPrice(preview.liq)}`}
                  tone="down"
                />
              )}
              {!isAdd && preview.realized != null && (
                <div className="flex items-center justify-between">
                  <span className="text-text-muted">Realized PnL</span>
                  <span
                    className={`tabular font-semibold ${
                      preview.realized >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {preview.realized >= 0 ? "+" : "−"}
                    {usd2(Math.abs(preview.realized))}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-text-muted">Leverage</span>
                <span className="tabular font-semibold text-text">
                  {pos.leverage}×
                </span>
              </div>
            </div>
            {isAdd && (
              // Leverage is inherited, never re-chosen here: adding at a
              // different leverage silently re-prices liquidation across the
              // WHOLE position, not just the new slice.
              <p className="mt-2 text-[11px] text-text-muted">
                Added at the position&apos;s current {pos.leverage}× leverage.
              </p>
            )}
            {!isAdd && pos.trailActive && (
              // The trail stop is a price, not a size — it survives a reduce
              // and keeps protecting whatever is left.
              <p className="mt-2 text-[11px] text-text-muted">
                Trailing stop stays armed on the remaining size.
              </p>
            )}
          </section>
        )}

        <button
          type="button"
          onClick={confirm}
          disabled={disabled}
          className={`flex items-center justify-center gap-2 rounded-full py-4 text-base font-semibold uppercase tracking-widest transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
            isAdd ? "bg-up-soft text-up" : "bg-down-soft text-down"
          }`}
        >
          {submitting && (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={18}
              className="animate-spin"
            />
          )}
          {submitting
            ? isAdd
              ? "Adding…"
              : "Reducing…"
            : `${isAdd ? "Add" : "Reduce"} ${usd2(amount)}`}
        </button>
      </div>
    </Sheet>
  );
}

/** A before → after line. Showing both is what makes the change legible. */
function Row({
  label,
  from,
  to,
  tone,
}: {
  label: string;
  from: string;
  to: string;
  tone?: "down";
}) {
  const changed = from !== to;
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="tabular flex items-center gap-1.5 font-semibold">
        {changed && (
          <>
            <span className="text-text-muted line-through opacity-60">
              {from}
            </span>
            <span className="text-text-muted">→</span>
          </>
        )}
        <span className={tone === "down" ? "text-down" : "text-text"}>{to}</span>
      </span>
    </div>
  );
}
