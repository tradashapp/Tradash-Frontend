"use client";

import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import type { MarketSymbol } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

// Trading defaults + preferences. Applied to every new trade. Persisted to
// localStorage via the settings slice subscription.
export function SettingsSheet({ open, onClose }: Props) {
  const dispatch = useAppDispatch();
  const s = useAppSelector((st) => st.settings);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="glass fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-3xl p-4 pb-8"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15" />
            <h2 className="mb-3 px-1 text-sm font-medium text-text-muted">
              Settings
            </h2>

            <div className="flex flex-col gap-2">
              {/* Defaults applied to every new trade */}
              <Stepper
                label="Default position size"
                value={s.defaultPositionSize}
                suffix="$"
                step={25}
                min={5}
                onChange={(v) => dispatch(updateSettings({ defaultPositionSize: v }))}
              />
              <Stepper
                label="Default leverage"
                value={s.defaultLeverage}
                suffix="×"
                step={1}
                min={1}
                max={100}
                onChange={(v) => dispatch(updateSettings({ defaultLeverage: v }))}
              />
              <Stepper
                label="Trailing stop distance"
                value={+(s.defaultTrailPct * 100).toFixed(2)}
                suffix="%"
                step={0.1}
                min={0.1}
                decimals={1}
                onChange={(v) =>
                  dispatch(updateSettings({ defaultTrailPct: v / 100 }))
                }
              />

              {/* Preferred market */}
              <div className="glass-inset rounded-2xl px-4 py-3">
                <div className="mb-2 text-sm">Preferred market</div>
                <div className="grid grid-cols-3 gap-2">
                  {MARKET_ORDER.map((sym: MarketSymbol) => (
                    <button
                      key={sym}
                      type="button"
                      onClick={() =>
                        dispatch(updateSettings({ preferredMarket: sym }))
                      }
                      className={`rounded-xl py-2 text-sm font-semibold transition-colors ${
                        s.preferredMarket === sym
                          ? "bg-up text-black"
                          : "bg-white/5 text-text-muted"
                      }`}
                    >
                      {MARKETS[sym].symbol}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toggles */}
              <ToggleRow
                label="Sound effects"
                on={s.soundEnabled}
                onChange={(on) => dispatch(updateSettings({ soundEnabled: on }))}
              />
              <ToggleRow
                label="Haptics"
                on={s.hapticsEnabled}
                onChange={(on) => dispatch(updateSettings({ hapticsEnabled: on }))}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function Stepper({
  label,
  value,
  onChange,
  step,
  min = 0,
  max = Infinity,
  suffix,
  decimals = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  max?: number;
  suffix?: string;
  decimals?: number;
}) {
  const clamp = (v: number) =>
    +Math.min(max, Math.max(min, v)).toFixed(decimals);
  return (
    <div className="glass-inset flex items-center justify-between rounded-2xl px-4 py-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-text transition-colors hover:bg-white/15"
        >
          <HugeiconsIcon icon={MinusSignIcon} size={16} />
        </button>
        <span className="tabular w-16 text-center text-sm font-semibold">
          {suffix === "$" ? "$" : ""}
          {value}
          {suffix && suffix !== "$" ? suffix : ""}
        </span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-text transition-colors hover:bg-white/15"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={16} />
        </button>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="glass-inset flex items-center justify-between rounded-2xl px-4 py-3">
      <span className="text-sm">{label}</span>
      <ToggleSwitch on={on} onChange={onChange} />
    </div>
  );
}
