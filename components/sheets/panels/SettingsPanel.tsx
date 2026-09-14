"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { setMode } from "@/store/slices/tradingModeSlice";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { MenuSection } from "@/components/ui/MenuSection";

// Settings content, rendered inside the AccountSheet as a sub-view. Edits the
// settings slice (persisted). No sheet chrome here — the host provides it.
//
// Order defaults (size, leverage, trailing) deliberately do NOT live here any
// more. They are per-market and are set from the market settings sheet, opened
// from the dock on the chart — next to the market they apply to, and next to
// the balance that bounds them. What is left is genuinely global: which mode
// you are trading, and how the app responds to a tap.
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
