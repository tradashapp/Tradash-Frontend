"use client";

import { useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { Sheet } from "@/components/ui/Sheet";
import {
  MARKETS,
  MIN_NOTIONAL_USD,
  defaultSizeFor,
  maxLeverageFor,
  minSizeFor,
} from "@/lib/markets";
import { config } from "@/lib/config";
import { MARGIN_HEADROOM } from "@/hooks/useTrade";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import type { useLeverage } from "@/hooks/useLeverage";
import type { MarketSymbol } from "@/types";

/**
 * Market settings — the SIZE of the next order on the market being traded.
 *
 * Replaces the old add/reduce dock panel. That dock was a position TOOL: it
 * existed only while a trade was open, and its buttons changed a live
 * position. This is a pre-trade CONFIGURATION surface, which is why it is
 * reachable with a flat account and why the positions list moved in
 * underneath — the two questions asked here are "what will my next order look
 * like" and "what am I already in".
 *
 * SIZE IS THE ONLY OPTION. Leverage and trailing used to be edited here too;
 * both sections are COMMENTED OUT below rather than deleted, so they can come
 * back without being rebuilt. They did not become unused — they became fixed:
 *   - leverage: every market trades at its OWN cap (`leverageFor` falls back to
 *     the max, and `store/persist.ts` clears leverage a device had already
 *     stored, so nobody is left on a lower one they can no longer see);
 *   - trailing: fixed at the 0.1% default in the settings slice.
 * `useLeverage` is still threaded in as a prop and still read here, because the
 * min order size depends on the leverage the order will actually use.
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
// $50 minimum notional converts to a different margin at each market's leverage
// (BTC 40× → $1.25, ETH 25× → $2, 10× → $5). See `minSizeFor` in lib/markets.

// Trailing-distance bounds for the slider, in percent. Used only by the
// disabled trailing section below; kept so that block still type-checks.
const TRAIL_MIN_PCT = 0.1;
const TRAIL_MAX_PCT = 10;

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

  // Leverage is no longer editable, but it is still READ: it is what turns
  // Bulk's $50 notional floor into this market's margin floor, and what the
  // notional readout is derived from.
  const lev = leverage.leverageOf(symbol);
  // Only the disabled leverage section reads this; kept so it still compiles.
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

  // Builder fee, charged on notional. Read from config (Bulk caps it at 1–15
  // bps) rather than hard-coded, so the number shown is the one actually sent.
  const feeBps = config.builder.feeBps;
  const feeUsd = (notional * feeBps) / 10_000;

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
        {/* ---- Size ------------------------------------------------------- */}
        <section className="glass-inset rounded-2xl p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
              Size
            </span>
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

          {/* Why the floor is where it is. Without this the minimum reads as an
              arbitrary number that moves between markets. */}
          <p className="mt-2 text-[11px] leading-snug text-text-muted">
            Minimum{" "}
            <span className="tabular text-text">{usd4(minSize)}</span> on{" "}
            {MARKETS[symbol].symbol} — orders must be worth at least $
            {MIN_NOTIONAL_USD} at {lev}×.
          </p>

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

        {/* ---- Leverage + Trailing (DISABLED) -------------------------------
            Both controls were removed from this sheet: size is now the only
            thing edited here. They are kept, compiling and type-checked, behind
            a `false` guard rather than deleted or block-commented, so bringing
            either back is a one-word change and neither silently rots.

            What they do now instead of being edited:
              - leverage: every market trades at its own cap (`leverageFor`
                falls back to `maxLeverageFor`), and `store/persist.ts` clears
                any lower value a device had already saved;
              - trailing: fixed at `defaultTrailPct` (0.1%) in the settings
                slice, which is what `useTrade` reads for every order.

            NOTE if reviving the leverage slider: the minimum order size is
            DERIVED from leverage (`minSizeFor`), so lowering it must also push
            `defaultPositionSize` up to the new floor, or every order under it
            is rejected for sub-$50 notional. --------------------------------- */}
        {false && (
          <>
          <section className="glass-inset rounded-2xl p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                Leverage
              </span>
              <span className="tabular text-[11px] text-text-muted">
                max {max}×
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="tabular text-2xl font-bold text-text">
                {lev.toFixed(2)}×
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
              onChange={(e) =>
                leverage.setLeverage(symbol, Number(e.target.value))
              }
              aria-label={`${symbol} leverage`}
              className="lev-slider mt-3 w-full"
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
                    onClick={() => {
                      playSound("tap");
                      haptic("tap");
                      leverage.setLeverage(symbol, p);
                    }}
                    className={`tabular flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                      lev === p
                        ? "bg-up text-black"
                        : "bg-white/[0.07] text-text-muted hover:bg-white/10"
                    }`}
                  >
                    {p}×
                  </button>
                ))}
            </div>

            {!leverage.canSync && (
              <p className="mt-2 text-[11px] leading-snug text-text-muted">
                Saved on this device. Finish setup and switch to live to apply
                this on your trading account.
              </p>
            )}
          </section>

          {/* ---- Trailing ---------------------------------------------------- */}
          <section className="glass-inset rounded-2xl p-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
                Trailing stop
              </span>
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
              {[0.5, 1, 2, 5].map((p) => (
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
          </>
        )}

        {/* ---- What the next order costs ----------------------------------- */}
        <section className="glass-inset flex flex-col gap-2 rounded-2xl p-4">
          <SummaryRow label="Trade size" value={usd2(notional)} />
          <SummaryRow label="Margin at risk" value={usd2(effectiveSize)} />
          <SummaryRow label={`Fee (${feeBps}bps)`} value={usd2(feeUsd)} muted />
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

function SummaryRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-text-muted">{label}</span>
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
