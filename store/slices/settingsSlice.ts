import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol } from "@/types";

// Defaults applied to every new trade + UI preferences. Persisted to
// localStorage (see store/persist.ts) so they survive reloads.
export interface SettingsState {
  defaultPositionSize: number; // in quote (USD)
  defaultLeverage: number;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  /** Trailing-stop distance behind price, as a fraction (e.g. 0.01 = 1%). */
  defaultTrailPct: number;
  preferredMarket: MarketSymbol;
  /** Markets the user starred in the market switcher, in the order added. */
  favouriteMarkets: MarketSymbol[];
  theme: "dark" | "light";
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  /** Whether the first-run "how it works" tutorial has been shown. */
  tutorialSeen: boolean;
}

const initialState: SettingsState = {
  defaultPositionSize: 100,
  defaultLeverage: 10,
  takeProfitPct: null,
  stopLossPct: null,
  defaultTrailPct: 0.001, // 1% trailing distance by default
  preferredMarket: "BTC",
  theme: "dark",
  soundEnabled: true,
  hapticsEnabled: true,
  tutorialSeen: false,
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
