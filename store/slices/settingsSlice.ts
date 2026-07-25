import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol } from "@/types";

// Defaults applied to every new trade + UI preferences. Persisted to
// localStorage (see store/persist.ts) so they survive reloads.
export interface SettingsState {
  defaultPositionSize: number; // in quote (USD)
  defaultLeverage: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  preferredMarket: MarketSymbol;
  theme: "dark" | "light";
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

const initialState: SettingsState = {
  defaultPositionSize: 100,
  defaultLeverage: 10,
  takeProfitPct: null,
  stopLossPct: null,
  preferredMarket: "BTC",
  theme: "dark",
  soundEnabled: true,
  hapticsEnabled: true,
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    updateSettings(state, action: PayloadAction<Partial<SettingsState>>) {
      return { ...state, ...action.payload };
    },
    hydrateSettings(_state, action: PayloadAction<SettingsState>) {
      return action.payload;
    },
  },
});

export const { updateSettings, hydrateSettings } = settingsSlice.actions;
export { initialState as defaultSettings };
export default settingsSlice.reducer;
