"use client";

import { useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { setMode } from "@/store/slices/tradingModeSlice";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { MenuSection } from "@/components/ui/MenuSection";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import type { MarketSymbol } from "@/types";

// Settings content, rendered inside the AccountSheet as a sub-view. Edits the
// settings slice (persisted). No sheet chrome here — the host provides it.
export function SettingsPanel() {
  const dispatch = useAppDispatch();
  const s = useAppSelector((st) => st.settings);
  const mode = useAppSelector((st) => st.tradingMode.mode);

  return (
    <div className="flex flex-col">
      {/* Demo mode toggle. Live is the default; turning this ON switches to
          demo (simulated funds). The choice is remembered across reloads. */}
      <MenuSection title="Mode" className="mb-4">
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="leading-tight">
            <div className="text-sm font-medium">Demo mode</div>
            <div className="text-xs text-text-muted">
              {mode === "demo"
                ? "Practicing with simulated funds"
                : "Trading live with real funds"}
            </div>
          </div>
          <ToggleSwitch
            on={mode === "demo"}
            onChange={(on) => dispatch(setMode(on ? "demo" : "live"))}
          />
        </div>
      </MenuSection>

      {/* Defaults applied to every new trade. */}
      <MenuSection title="Trade defaults" className="mb-4">
        <Stepper
          label="Position size"
          value={s.defaultPositionSize}
          suffix="$"
          step={25}
          min={5}
          onChange={(v) => dispatch(updateSettings({ defaultPositionSize: v }))}
        />
        <Stepper
          label="Leverage"
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
          onChange={(v) => dispatch(updateSettings({ defaultTrailPct: v / 100 }))}
        />
        {/* Market the app opens on. Scrolls horizontally rather than wrapping
            into a tall grid — the list grows as markets are added. */}
        <div className="px-4 py-3">
          <div className="mb-2 text-sm">Preferred market</div>
          <div className="scroll-glass -mx-4 overflow-x-auto px-4">
            <div className="flex w-max items-center gap-2">
              {MARKET_ORDER.map((sym: MarketSymbol) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() =>
                    dispatch(updateSettings({ preferredMarket: sym }))
                  }
                  className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
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
        </div>
      </MenuSection>

      {/* Feedback on interaction. */}
      <MenuSection title="Feedback">
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
      </MenuSection>
    </div>
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

  // Tap the number itself to type it manually (instead of only +/− stepping).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commit = () => {
    const v = Number(draft);
    if (!Number.isNaN(v) && draft.trim() !== "") onChange(clamp(v));
    setEditing(false);
  };
  const startEdit = () => {
    setDraft(String(value));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };

  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-text transition-colors hover:bg-white/15 active:scale-90"
        >
          <HugeiconsIcon icon={MinusSignIcon} size={16} />
        </button>
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="tabular w-16 bg-transparent text-center text-sm font-semibold text-text outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="tabular w-16 text-center text-sm font-semibold text-text"
            aria-label={`Edit ${label}`}
          >
            {suffix === "$" ? "$" : ""}
            {value}
            {suffix && suffix !== "$" ? suffix : ""}
          </button>
        )}
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-text transition-colors hover:bg-white/15 active:scale-90"
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
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-sm">{label}</span>
      <ToggleSwitch on={on} onChange={onChange} />
    </div>
  );
}
