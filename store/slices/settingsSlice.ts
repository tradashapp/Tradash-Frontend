import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol } from "@/types";

// Defaults applied to every new trade + UI preferences. Persisted to
// localStorage (see store/persist.ts) so they survive reloads.
export interface SettingsState {
  defaultPositionSize: number; // in quote (USD)
  /**
   * Leverage PER MARKET, e.g. { BTC: 20, SOL: 5 }. Sparse — a market absent
   * here uses DEFAULT_LEVERAGE (clamped to that market's own cap).
   *
   * Per-market because every market has a different ceiling on Bulk
   * (`MARKETS[x].maxLeverage`: BTC 40×, ETH 25×, most alts 10×), so one global
   * number could never be valid everywhere. Mirrors Bulk's own model —
   * leverage lives on the account per symbol (`leverageSettings[]`), not on the
   * order — and is pushed there via lib/bulk/leverage.ts.
   */
  leverageByMarket: Partial<Record<MarketSymbol, number>>;
  takeProfitPct: number | null;
  stopLossPct: number | null;
  /** Trailing-stop distance behind price, as a fraction (e.g. 0.01 = 1%). */
  defaultTrailPct: number;
  /** Markets the user starred in the market switcher, in the order added. */
  favouriteMarkets: MarketSymbol[];
  theme: "dark" | "light";
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  /** Whether the first-run "how it works" tutorial has been shown. */
  tutorialSeen: boolean;
  /**
   * Profile avatar. Either an emoji (one of AVATAR_EMOJIS) or a data-URL for a
   * photo the user picked from their device (downscaled before it's stored, so
   * the settings blob stays small enough for localStorage).
   */
  avatar: string;
}

const initialState: SettingsState = {
  defaultPositionSize: 100,
  leverageByMarket: {},
  takeProfitPct: null,
  stopLossPct: null,
  defaultTrailPct: 0.001, // 1% trailing distance by default
  favouriteMarkets: [],
  theme: "dark",
  soundEnabled: true,
  hapticsEnabled: true,
  tutorialSeen: false,
  avatar: "\u{1F680}", // rocket
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
    /** Set (or clear) one market's leverage. Callers clamp to the market cap. */
    setMarketLeverage(
      state,
      action: PayloadAction<{ symbol: MarketSymbol; leverage: number }>
    ) {
      const { symbol, leverage } = action.payload;
      state.leverageByMarket[symbol] = leverage;
    },
    toggleFavouriteMarket(state, action: PayloadAction<MarketSymbol>) {
      const symbol = action.payload;
      const i = state.favouriteMarkets.indexOf(symbol);
      if (i === -1) state.favouriteMarkets.push(symbol);
      else state.favouriteMarkets.splice(i, 1);
    },
  },
});

export const {
  updateSettings,
  hydrateSettings,
  setMarketLeverage,
  toggleFavouriteMarket,
} = settingsSlice.actions;
export { initialState as defaultSettings };
export default settingsSlice.reducer;
