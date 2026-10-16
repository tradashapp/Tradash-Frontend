"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { setLimitEnabled, setLimitPrice } from "@/store/slices/tradingSlice";
import { Sheet } from "@/components/ui/Sheet";
import {
  MARKETS,
  minNotionalFor,
  defaultSizeFor,
  maxLeverageFor,
  minSizeFor,
  roundToTick,
} from "@/lib/markets";
import { MARGIN_HEADROOM } from "@/hooks/useTrade";
import { bpsAsPct, useTradingFees } from "@/hooks/useTradingFees";
import { InfoTip } from "@/components/ui/InfoTip";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import type { useLeverage } from "@/hooks/useLeverage";
import type { MarketSymbol } from "@/types";

/**
 * Market settings — the SIZE and LEVERAGE of the next order on the market being traded.
 *
 * Replaces the old add/reduce dock panel. That dock was a position TOOL: it
 * existed only while a trade was open, and its buttons changed a live
 * position. This is a pre-trade CONFIGURATION surface, which is why it is
 * reachable with a flat account and why the positions list moved in
 * underneath — the two questions asked here are "what will my next order look
 * like" and "what am I already in".
 *
 * SIZE AND LEVERAGE are edited here. Leverage defaults to each market's OWN
 * cap (`leverageFor` falls back to the max), so a user who never opens the
 * slider trades at max; moving it pushes `updateUserSettings` to Bulk through
 * `useLeverage`. Trailing distance is editable again (2026-09-27), defaulting
 * to 0.1% (`defaultTrailPct` in the settings slice).
 *
 * WHERE THE VALUE GOES. The size written here goes straight to the settings
 * slice (`defaultPositionSize`) — the exact state `useTrade.open()` reads when
 * it places an order. There is deliberately no local draft copy: there is one
 * source of truth, so a number changed here IS the next order.
 *
 * It also sets `positionSizeTouched`, which stops `useDefaultSize` from
 * recomputing the default underneath the user. That flag is the whole reason a
 * hand-picked size survives the next balance tick.
 */

/** Two decimals everywhere in this sheet, per the dock's display rule. */
const usd2 = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Sizes only — they carry up to 4 decimals and must be shown EXACTLY.
 *
 * A minimum of $1.2625 displayed as "$1.26" is a number that gets rejected when
 * typed back in, so trailing precision is kept where it exists and dropped
 * where it doesn't ($5, not $5.0000).
 */
const usd4 = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;

// The size floor is no longer a flat constant: it is PER MARKET, because Bulk's
// per-market minimum notional converts to a different margin at each market's
// leverage (BTC $1 / 40× → $0.025, ETH $50 / 25× → $2, ZEC $40 / 10× → $4).
// See `minSizeFor` in lib/markets.

// Trailing-distance bounds for the slider, in percent. Sent to Bulk as whole
// basis points (`trailBps` in useTrade), so 0.1% steps are exact.
const TRAIL_MIN_PCT = 0.1;
const TRAIL_MAX_PCT = 10;
// Quick picks, starting at the 0.1% default so it's one tap to get back to.
const TRAIL_PRESETS_PCT = [0.1, 0.5, 1, 2];

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: MarketSymbol;
  leverage: ReturnType<typeof useLeverage>;
}

export function MarketSettingsSheet({
  open,
  onClose,
  symbol,
  leverage,
}: Props) {
  const dispatch = useAppDispatch();
  const s = useAppSelector((st) => st.settings);
  const mode = useAppSelector((st) => st.tradingMode.mode);
  const liveBalance = useAppSelector((st) => st.user.balance);
  const demoBalance = useAppSelector((st) => st.tradingMode.demo.balance);

  // What the slider is scaled against. Demo keeps no margin breakdown, so its
  // realized balance stands in for "what you could post".
  const available =
    mode === "demo" ? demoBalance : liveBalance?.available ?? null;

  // Leverage is also what turns Bulk's notional floor into this market's
  // margin floor, and what the notional readout is derived from.
  const lev = leverage.leverageOf(symbol);
  // Frozen while this market has an open position — see `useLeverage.isLocked`.
  const levLocked = leverage.isLocked(symbol);
  // The slider's upper bound — and the default for an untouched market.
  const max = maxLeverageFor(symbol);
  const size = s.defaultPositionSize;

  // This market's floor, and the default the size would return to. Both depend
  // on the leverage the order will actually use, so both are recomputed when
  // the market changes.
  const minSize = minSizeFor(symbol, s.leverageByMarket);
  const autoSize = defaultSizeFor(symbol, available, s.leverageByMarket);

  // What the order will ACTUALLY post as margin.
  //
  // `useTrade.open()` caps margin at a fraction of free balance (Bulk margins
  // against its own equity at fill time, and sizing to 100% is rejected for the
  // drift). Mirroring that here — rather than echoing the configured size — is
  // what stops the sheet promising a $40,000 position that gets filled at
  // $19,600. The same expression is used, from the same constant.
  const effectiveSize =
    available != null ? Math.min(size, available * MARGIN_HEADROOM) : size;
  const trimmed = effectiveSize < size - 0.005;

  // Notional is DISPLAY ONLY. The order carries margin and Bulk derives the
  // rest; showing this is what makes a leverage change legible — the margin at
  // risk holds still while the position grows.
  const notional = effectiveSize * lev;

  // Fees to OPEN, charged on notional: Bulk's exchange fee + this user's
  // Tradash fee (the server-issued rate, so a fee code's discount shows).
  const fees = useTradingFees();
  const bulkUsd = (notional * fees.bulkBps) / 10_000;
  const tradashUsd = (notional * fees.tradashBps) / 10_000;

  // An unknown or empty balance must not collapse the slider to nothing — fall
  // back to the current size so the control still works while the feed catches
  // up, rather than trapping the handle at the minimum.
  const sliderMax = useMemo(() => {
    if (available == null || available <= 0) return Math.max(size, minSize * 20);
    // Never below the floor, or the slider would have an inverted range on an
    // account too small to meet this market's minimum at all.
    return Math.max(available, minSize);
  }, [available, size, minSize]);

  // Every size the user picks is a DELIBERATE one, so it also sets
  // `positionSizeTouched` and the auto-default stops applying from here on.
  //
  // Four decimals, not two: the minimum is itself a 4-decimal number
  // ($1.2625 on BTC), and rounding it to cents would round it back under the
  // notional floor — the exact rejection this is all meant to avoid.
  const setSize = (v: number) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(sliderMax, Math.max(minSize, v));
    dispatch(
      updateSettings({
        defaultPositionSize: +clamped.toFixed(4),
        positionSizeTouched: true,
      })
    );
  };

  /** Hand the size back to the auto-default (min, or 5% of available). */
  const resetSize = () => {
    dispatch(
      updateSettings({
        defaultPositionSize: autoSize,
        positionSizeTouched: false,
      })
    );
  };

  const pctOfAvailable =
    available != null && available > 0 ? (size / available) * 100 : null;

  const trailPct = s.defaultTrailPct * 100;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={`${MARKETS[symbol].symbol} settings`}
    >
      <div className="flex flex-col gap-4 pb-2">
        <OrderTypeSection symbol={symbol} live={mode === "live"} />

        {/* ---- Size ------------------------------------------------------- */}
        <section className="glass-inset rounded-2xl p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <SectionTitle title="Size">
              The margin each trade puts up from your trading balance. Trade
              size is this × leverage. Minimum{" "}
              <span className="tabular text-text">{usd4(minSize)}</span> on{" "}
              {MARKETS[symbol].symbol}: Bulk needs orders worth at least $
              {minNotionalFor(symbol)}.
            </SectionTitle>
            <span className="text-[11px] text-text-muted">
              {available == null ? (
                "Balance unavailable"
              ) : (
                <>
                  <span className="tabular text-text">{usd2(available)}</span>{" "}
                  available
                </>
              )}
            </span>
          </div>

          <div className="flex items-end justify-between gap-3">
            <SizeInput value={size} min={minSize} onChange={setSize} />
            {pctOfAvailable != null && (
              <span className="tabular pb-1.5 text-xs text-text-muted">
                {pctOfAvailable.toFixed(0)}% of available
              </span>
            )}
          </div>

          <input
            type="range"
            min={minSize}
            max={Math.max(sliderMax, minSize)}
            step={0.01}
            value={Math.min(Math.max(size, minSize), sliderMax)}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="Position size"
            className="lev-slider mt-3 w-full"
            style={{
              // Fill is measured across [minSize, sliderMax], not from zero —
              // the handle can never sit left of the floor, so a zero-based
              // fill would never empty.
              ["--fill" as string]: `${
                ((Math.min(Math.max(size, minSize), sliderMax) - minSize) /
                  Math.max(sliderMax - minSize, 0.0001)) *
                100
              }%`,
            }}
          />

          <div className="mt-2 flex items-center gap-2">
            {/* "Min" is this market's floor, which is why it is a preset and
                not a fixed percentage: it is the one size guaranteed to be
                accepted, and on a small account it is the only one. */}
            <button
              type="button"
              onClick={() => {
                playSound("tap");
                haptic("tap");
                setSize(minSize);
              }}
              className={`tabular flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                Math.abs(size - minSize) < 0.0005
                  ? "bg-up text-black"
                  : "bg-white/[0.07] text-text-muted hover:bg-white/10"
              }`}
            >
              Min
            </button>
            {[0.25, 0.5, 1].map((f) => {
              const target = available != null && available > 0 ? available * f : null;
              const active = target != null && Math.abs(size - target) < 0.005;
              return (
                <button
                  key={f}
                  type="button"
                  disabled={target == null}
                  onClick={() => {
                    playSound("tap");
                    haptic("tap");
                    if (target != null) setSize(target);
                  }}
                  className={`tabular flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                    active
                      ? "bg-up text-black"
                      : "bg-white/[0.07] text-text-muted hover:bg-white/10"
                  }`}
                >
                  {f === 1 ? "Max" : `${f * 100}%`}
                </button>
              );
            })}
          </div>

          {/* Only offered once the size has actually been pinned by hand, and
              only when it differs from what the default would be — otherwise
              it is a button that visibly does nothing. */}
          {s.positionSizeTouched && Math.abs(size - autoSize) > 0.0005 && (
            <button
              type="button"
              onClick={() => {
                playSound("tap");
                haptic("tap");
                resetSize();
              }}
              className="mt-2 text-[11px] font-semibold text-text-muted underline underline-offset-2 hover:text-text"
            >
              Reset to default ({usd4(autoSize)})
            </button>
          )}
        </section>

        {/* ---- Leverage ---------------------------------------------------
            Revived 2026-09-24 on community feedback. It still DEFAULTS to the
            market's own cap: `leverageFor` falls back to `maxLeverageFor` for
            any market the user has not touched, so the slider opens at max.

            Lowering it raises this market's minimum size (`minSizeFor` divides
            the market's notional floor by leverage). `useDefaultSize` watches
            `leverageByMarket` and lifts `defaultPositionSize` to the new floor,
            so a lower leverage can never leave a size Bulk would reject. */}
          <section className="glass-inset rounded-2xl p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <SectionTitle title="Leverage">
                Multiplies your trade size, and your gains and losses with it.
                The higher it is, the smaller the move against you that
                liquidates the trade. Saved for {MARKETS[symbol].symbol} only.
              </SectionTitle>
              <span className="tabular text-[11px] text-text-muted">
                max {max}×
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="tabular text-2xl font-bold text-text">
                {lev}×
              </span>
              <span className="text-[11px] leading-tight text-text-muted">
                liquidates on a{" "}
                <span className="tabular text-text">
                  {(100 / lev).toFixed(2)}%
                </span>{" "}
                move against you
              </span>
            </div>

            <input
              type="range"
              min={1}
              max={max}
              step={1}
              value={lev}
              disabled={levLocked}
              onChange={(e) =>
                leverage.setLeverage(symbol, Number(e.target.value))
              }
              aria-label={`${symbol} leverage`}
              className="lev-slider mt-3 w-full disabled:opacity-40"
              style={{
                ["--fill" as string]: `${((lev - 1) / Math.max(max - 1, 1)) * 100}%`,
              }}
            />

            <div className="mt-2 flex items-center gap-2">
              {[...new Set([1, Math.round(max / 4), Math.round(max / 2), max])]
                .filter((n) => n >= 1 && n <= max)
                .map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={levLocked}
                    onClick={() => {
                      playSound("tap");
                      haptic("tap");
                      leverage.setLeverage(symbol, p);
                    }}
                    className={`tabular flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                      lev === p
                        ? "bg-up text-black"
                        : "bg-white/[0.07] text-text-muted hover:bg-white/10"
                    }`}
                  >
                    {p}×
                  </button>
                ))}
            </div>

            {levLocked ? (
              <p className="mt-2 text-[11px] leading-snug text-text-muted">
                Locked while your {MARKETS[symbol].symbol} position is open.
                Close it to change leverage.
              </p>
            ) : !leverage.canSync && (
              <p className="mt-2 text-[11px] leading-snug text-text-muted">
                Saved on this device. Finish setup and switch to live to apply
                this on your trading account.
              </p>
            )}
          </section>

        {/* ---- Trailing ----------------------------------------------------
            Revived 2026-09-27. The distance the trailing stop keeps behind
            price; `useTrade` reads `defaultTrailPct` when arming a trail (and
            when resizing one after an add). Default 0.1%. */}
          <section className="glass-inset rounded-2xl p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <SectionTitle title="Trailing stop">
                When you turn on Trail for a trade in profit, a stop follows
                price as it moves your way and stays this far behind its best
                level. If price pulls back this much, the trade closes and keeps
                the profit locked in so far.
              </SectionTitle>
              <span className="tabular text-[11px] text-text-muted">
                behind price
              </span>
            </div>

            <span className="tabular text-2xl font-bold text-text">
              {trailPct.toFixed(2)}%
            </span>

            <input
              type="range"
              min={TRAIL_MIN_PCT}
              max={TRAIL_MAX_PCT}
              step={0.1}
              value={+trailPct.toFixed(2)}
              onChange={(e) =>
                dispatch(
                  updateSettings({ defaultTrailPct: Number(e.target.value) / 100 })
                )
              }
              aria-label="Trailing stop distance"
              className="lev-slider mt-3 w-full"
              style={{
                ["--fill" as string]: `${
                  ((trailPct - TRAIL_MIN_PCT) / (TRAIL_MAX_PCT - TRAIL_MIN_PCT)) *
                  100
                }%`,
              }}
            />

            <div className="mt-2 flex items-center gap-2">
              {TRAIL_PRESETS_PCT.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    playSound("tap");
                    haptic("tap");
                    dispatch(updateSettings({ defaultTrailPct: p / 100 }));
                  }}
                  className={`tabular flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                    Math.abs(trailPct - p) < 0.001
                      ? "bg-up text-black"
                      : "bg-white/[0.07] text-text-muted hover:bg-white/10"
                  }`}
                >
                  {p.toFixed(2)}%
                </button>
              ))}
            </div>
          </section>

        {/* ---- What the next order costs ----------------------------------- */}
        <section className="glass-inset flex flex-col gap-2 rounded-2xl p-4">
          <SummaryRow
            label="Trade size"
            value={usd2(notional)}
            tip={<>Size × leverage: the position this order opens.</>}
          />
          <SummaryRow
            label="Margin at risk"
            value={usd2(effectiveSize)}
            tip={<>The collateral this trade uses from your trading balance.</>}
          />
          <SummaryRow
            label="Fees"
            value={fees.demo ? "Free" : usd2(bulkUsd + tradashUsd)}
            muted
            tip={
              fees.demo ? (
                <>Demo trades are free. Live trades pay Bulk&apos;s exchange fee plus the Tradash fee.</>
              ) : (
                <>
                  Paid when the trade opens, on trade size:
                  <FeeLine label="Bulk exchange" bps={fees.bulkBps} usd={bulkUsd} />
                  <FeeLine
                    label={fees.code ? `Tradash (code ${fees.code})` : "Tradash"}
                    bps={fees.tradashBps}
                    usd={tradashUsd}
                  />
                  <FeeLine label="Total" bps={fees.totalBps} usd={bulkUsd + tradashUsd} strong />
                  <span className="mt-1.5 block">
                    Closing pays Bulk&apos;s fee again, with no Tradash fee.
                  </span>
                </>
              )
            }
          />
          {trimmed && (
            <p className="mt-1 text-[11px] leading-snug text-text-muted">
              Capped at {usd2(effectiveSize)} — your size of {usd2(size)} is
              more than the free margin this order can use.
            </p>
          )}
        </section>
      </div>
    </Sheet>
  );
}

/**
 * Market vs limit for the next UP/DOWN. Limit writes the same draft the chart
 * tap does (`trading.limit`), so the price typed here and the line on the
 * chart are one value. Live only — a demo account has no book to rest on.
 */
function OrderTypeSection({
  symbol,
  live,
}: {
  symbol: MarketSymbol;
  live: boolean;
}) {
  const dispatch = useAppDispatch();
  const enabled = useAppSelector((st) => st.trading.limit.enabled) && live;
  const price = useAppSelector((st) => st.trading.limit.price[symbol]) ?? null;
  const mark = useAppSelector((st) => st.price.prices[symbol]) ?? null;

  const setPrice = (v: number | null) =>
    dispatch(setLimitPrice({ symbol, price: v }));
  const toMark = () => {
    if (mark != null) setPrice(roundToTick(symbol, mark));
  };
  const choose = (limit: boolean) => {
    playSound("tap");
    haptic("tap");
    dispatch(setLimitEnabled(limit));
    // Start from the mark, so there is a line on the chart to move.
    if (limit && price == null) toMark();
  };

  const away =
    enabled && price != null && mark != null && mark > 0
      ? ((price - mark) / mark) * 100
      : null;

  return (
    <section className="glass-inset rounded-2xl p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <SectionTitle title="Order type">
          Market fills now. Limit rests on Bulk until price reaches your level —
          type it here or tap the chart. Below the mark, UP waits for a dip;
          above it, it fills at once. Live trading only.
        </SectionTitle>
        {!live && (
          <span className="flex items-center gap-1 text-[11px] text-text-muted">
            Limit: live only
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        {[false, true].map((limit) => (
          <button
            key={String(limit)}
            type="button"
            disabled={limit && !live}
            onClick={() => choose(limit)}
            className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-colors disabled:opacity-40 ${
              enabled === limit
                ? "bg-white/[0.14] text-text"
                : "bg-white/[0.05] text-text-muted hover:bg-white/10"
            }`}
          >
            {limit ? "Limit" : "Market"}
          </button>
        ))}
      </div>

      {enabled && (
        <div className="mt-3 flex items-end justify-between gap-3">
          <LimitPriceInput value={price} onChange={setPrice} />
          <div className="flex items-center gap-2 pb-1.5">
            {away != null && (
              <span className="tabular text-xs text-text-muted">
                {away >= 0 ? "+" : "−"}
                {Math.abs(away).toFixed(2)}%
              </span>
            )}
            <button
              type="button"
              disabled={mark == null}
              onClick={() => {
                playSound("tap");
                haptic("tap");
                toMark();
              }}
              className="rounded-lg bg-white/[0.07] px-2.5 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              Mark
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Limit price field. Shows the user's own text while focused (so "9." is not
 * reformatted out from under them) and the stored value otherwise; the tick
 * rounding happens when the order is placed, not per keystroke.
 */
function LimitPriceInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const shown = value == null ? "" : String(value);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-2xl font-bold text-text-muted">$</span>
      <input
        inputMode="decimal"
        value={editing ? text : shown}
        placeholder="Tap chart"
        onFocus={() => {
          setEditing(true);
          setText(shown);
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, "");
          setText(raw);
          const n = Number(raw);
          onChange(raw === "" || !Number.isFinite(n) || n <= 0 ? null : n);
        }}
        aria-label="Limit price"
        className="tabular w-40 bg-transparent text-2xl font-bold text-text outline-none placeholder:text-base placeholder:font-semibold placeholder:text-text-muted/50"
      />
    </div>
  );
}

/** A section's uppercase label, with its explanation behind a "?". */
function SectionTitle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
      {title}
      <InfoTip size={13} label={`About ${title.toLowerCase()}`}>
        <span className="normal-case tracking-normal">{children}</span>
      </InfoTip>
    </span>
  );
}

/** One line of the fee breakdown inside the fee tip. */
function FeeLine({ label, bps, usd, strong = false }: { label: string; bps: number; usd: number; strong?: boolean }) {
  return (
    <span className={`mt-1 flex justify-between gap-3 ${strong ? "font-semibold text-text" : ""}`}>
      <span>{label}</span>
      <span className="tabular">
        {bpsAsPct(bps)} · {usd4(usd)}
      </span>
    </span>
  );
}

function SummaryRow({
  label,
  value,
  muted = false,
  tip,
}: {
  label: string;
  value: string;
  muted?: boolean;
  /** Explanation behind a "?" next to the label. */
  tip?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="flex items-center gap-1 text-xs text-text-muted">
        {label}
        {tip && <InfoTip size={12} label={`About ${label.toLowerCase()}`}>{tip}</InfoTip>}
      </span>
      <span
        className={`tabular text-sm font-semibold ${
          muted ? "text-text-muted" : "text-text"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Tap-to-type size field. The slider covers coarse moves; this covers exact ones. */
function SizeInput({
  value,
  min,
  onChange,
}: {
  value: number;
  /** This market's floor — see `minSizeFor`. */
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-2xl font-bold text-text-muted">$</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        step={0.01}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== "" && !Number.isNaN(v)) onChange(v);
        }}
        aria-label="Position size in dollars"
        className="tabular w-32 bg-transparent text-2xl font-bold text-text outline-none"
      />
    </div>
  );
}
