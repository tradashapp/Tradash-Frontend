"use client";

import { useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { Sheet } from "@/components/ui/Sheet";
import { PositionsPanel } from "@/components/trade/PositionsPanel";
import { MARKETS, maxLeverageFor } from "@/lib/markets";
import { config } from "@/lib/config";
import { useAllPositions } from "@/hooks/useAllPositions";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";
import type { useLeverage } from "@/hooks/useLeverage";
import type { MarketSymbol } from "@/types";
import type { ShareSubject } from "@/components/share/ShareCardModal";

/**
 * Market settings — size, leverage and trailing for the market being traded,
 * plus the full positions list.
 *
 * Replaces the old add/reduce dock panel. That dock was a position TOOL: it
 * existed only while a trade was open, and its buttons changed a live
 * position. This is a pre-trade CONFIGURATION surface, which is why it is
 * reachable with a flat account and why the positions list moved in
 * underneath — the two questions asked here are "what will my next order look
 * like" and "what am I already in".
 *
 * WHERE THE VALUES GO. Everything edited here writes to the settings slice
 * (`defaultPositionSize`, `leverageByMarket` via useLeverage, and
 * `defaultTrailPct`) — the exact state `useTrade.open()` reads when it places
 * an order. There is deliberately no local draft copy: there is one source of
 * truth, so a number changed here IS the next order.
 */

/** Two decimals everywhere in this sheet, per the dock's display rule. */
const usd2 = (n: number) =>
  `$${n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Floor for the size slider, so it can never land on an unfillable order. */
const MIN_SIZE_USD = 1;

/** Trailing-distance bounds for the slider, in percent. */
const TRAIL_MIN_PCT = 0.1;
const TRAIL_MAX_PCT = 10;

interface Props {
  open: boolean;
  onClose: () => void;
  symbol: MarketSymbol;
  leverage: ReturnType<typeof useLeverage>;
  onShare: (subject: ShareSubject) => void;
  onCloseAll?: () => void | Promise<void>;
}

export function MarketSettingsSheet({
  open,
  onClose,
  symbol,
  leverage,
  onShare,
  onCloseAll,
}: Props) {
  const dispatch = useAppDispatch();
  const s = useAppSelector((st) => st.settings);
  const mode = useAppSelector((st) => st.tradingMode.mode);
  const liveBalance = useAppSelector((st) => st.user.balance);
  const demoBalance = useAppSelector((st) => st.tradingMode.demo.balance);
  const { items } = useAllPositions();

  // What the slider is scaled against. Demo keeps no margin breakdown, so its
  // realized balance stands in for "what you could post".
  const available =
    mode === "demo" ? demoBalance : liveBalance?.available ?? null;

  const max = maxLeverageFor(symbol);
  const lev = leverage.leverageOf(symbol);
  const size = s.defaultPositionSize;

  // Notional is DISPLAY ONLY. The order carries margin and Bulk derives the
  // rest; showing this is what makes a leverage change legible — the margin at
  // risk holds still while the position grows.
  const notional = size * lev;

  // Builder fee, charged on notional. Read from config (Bulk caps it at 1–15
  // bps) rather than hard-coded, so the number shown is the one actually sent.
  const feeBps = config.builder.feeBps;
  const feeUsd = (notional * feeBps) / 10_000;

  // An unknown or empty balance must not collapse the slider to nothing — fall
  // back to the current size so the control still works while the feed catches
  // up, rather than trapping the handle at the minimum.
  const sliderMax = useMemo(() => {
    if (available == null || available <= 0) return Math.max(size, 100);
    return available;
  }, [available, size]);

  const setSize = (v: number) => {
    if (!Number.isFinite(v)) return;
    const clamped = Math.min(sliderMax, Math.max(MIN_SIZE_USD, v));
    dispatch(updateSettings({ defaultPositionSize: +clamped.toFixed(2) }));
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
            <SizeInput value={size} onChange={setSize} />
            {pctOfAvailable != null && (
              <span className="tabular pb-1.5 text-xs text-text-muted">
                {pctOfAvailable.toFixed(0)}% of available
              </span>
            )}
          </div>

          <input
            type="range"
            min={MIN_SIZE_USD}
            max={Math.max(sliderMax, MIN_SIZE_USD)}
            step={0.01}
            value={Math.min(size, sliderMax)}
            onChange={(e) => setSize(Number(e.target.value))}
            aria-label="Position size"
            className="lev-slider mt-3 w-full"
            style={{
              ["--fill" as string]: `${
                (Math.min(size, sliderMax) / Math.max(sliderMax, 1)) * 100
              }%`,
            }}
          />

          <div className="mt-2 flex items-center gap-2">
            {[0.1, 0.25, 0.5, 1].map((f) => {
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
        </section>

        {/* ---- Leverage ---------------------------------------------------- */}
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

        {/* ---- What the next order costs ----------------------------------- */}
        <section className="glass-inset flex flex-col gap-2 rounded-2xl p-4">
          <SummaryRow label="Trade size" value={usd2(notional)} />
          <SummaryRow label="Margin at risk" value={usd2(size)} />
          <SummaryRow label={`Fee (${feeBps}bps)`} value={usd2(feeUsd)} muted />
        </section>

        {/* ---- Positions ---------------------------------------------------
            The whole positions view, exactly as the old sheet showed it.
            PositionsPanel renders its own "No open positions" state, so a flat
            account says so rather than the section vanishing. */}
        <section>
          <h3 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
            Positions{items.length > 0 ? ` (${items.length})` : ""}
          </h3>
          <PositionsPanel
            onShare={(subject) => {
              onShare(subject);
              onClose();
            }}
            onNavigate={onClose}
            onCloseAll={onCloseAll}
          />
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
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-2xl font-bold text-text-muted">$</span>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={MIN_SIZE_USD}
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
