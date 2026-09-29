import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol } from "@/types";
import type { ChartView } from "@/lib/chart/engine";
import {
  DEFAULT_CANDLE_INTERVAL,
  type CandleInterval,
} from "@/lib/bulk/candles";
import { DEFAULT_TRACK } from "@/lib/music";

// Defaults applied to every new trade + UI preferences. Persisted to
// localStorage (see store/persist.ts) so they survive reloads.
export interface SettingsState {
  defaultPositionSize: number; // in quote (USD)
  /**
   * Whether `defaultPositionSize` was chosen BY HAND in the market settings
   * sheet, as opposed to being the auto-computed default.
   *
   * Until this is true the size is derived (see `defaultSizeFor`): the larger
   * of the market's minimum and 5% of the available trading balance, recomputed
   * as the balance and the market change. The moment the user sets a size
   * themselves it stops being recomputed — an explicit choice must not be
   * silently overwritten by the next balance tick.
   */
  positionSizeTouched: boolean;
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
  /** Chart type on the trade screen: live tick line or candles. */
  chartView: ChartView;
  /**
   * Whether `chartView` was picked BY HAND. Until it is, the default applies
   * on every load — so changing the default reaches everyone who never chose.
   */
  chartViewTouched: boolean;
  /** Candle interval for the candle view (Bulk klines interval). */
  chartInterval: CandleInterval;
  /** Markets the user starred in the market switcher, in the order added. */
  favouriteMarkets: MarketSymbol[];
  theme: "dark" | "light";
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  /**
   * Background music on the trade screen. Off by default: music that starts
   * on its own is an ambush, and browsers block it before a gesture anyway.
   */
  musicEnabled: boolean;
  /** Which of MUSIC_TRACKS (lib/music) plays. */
  musicTrack: string;
  /**
   * Emoji callouts over the chart while a position is open ("🎯 Perfect").
   * Per-move sounds and haptics follow soundEnabled / hapticsEnabled instead.
   */
  reactionsEnabled: boolean;
  /** Whether the first-run "how it works" tutorial has been shown. */
  tutorialSeen: boolean;
  /**
   * Whether the "share your feedback" banner in the account sheet was
   * dismissed. Persisted like `tutorialSeen` — a banner that came back on
   * every reload would be nagging, not asking.
   */
  feedbackBannerDismissed: boolean;
  /**
   * Profile avatar. Either an emoji (one of AVATAR_EMOJIS) or a data-URL for a
   * photo the user picked from their device (downscaled before it's stored, so
   * the settings blob stays small enough for localStorage).
   */
  avatar: string;
  /**
   * Whether the persisted blob has been loaded (store/persist.ts). NOT itself
   * persisted. Settings are read in an effect after mount, and child effects
   * run before that one — so anything acting on a stored flag at mount (the
   * first-run tutorial) must wait for this, or it sees the defaults.
   */
  hydrated: boolean;
}

const initialState: SettingsState = {
  // Placeholder only — replaced by `defaultSizeFor` as soon as a market and a
  // balance are known. It is deliberately the 10× market minimum rather than a
  // round $100, so a size is never shown that the account cannot cover.
  defaultPositionSize: 5.05,
  positionSizeTouched: false,
  leverageByMarket: {},
  takeProfitPct: null,
  stopLossPct: null,
  // 0.1% trailing distance. No longer editable in the settings sheet (that
  // section is commented out, not deleted) — every order trails at this.
  defaultTrailPct: 0.001,
  chartView: "line",
  chartViewTouched: false,
  chartInterval: DEFAULT_CANDLE_INTERVAL,
  favouriteMarkets: [],
  theme: "dark",
  soundEnabled: true,
  hapticsEnabled: true,
  musicEnabled: false,
  musicTrack: DEFAULT_TRACK,
  reactionsEnabled: true,
  tutorialSeen: false,
  feedbackBannerDismissed: false,
  avatar: "\u{1F680}", // rocket
  hydrated: false,
};

const settingsSlice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    updateSettings(state, action: PayloadAction<Partial<SettingsState>>) {
      return { ...state, ...action.payload };
    },
    hydrateSettings(_state, action: PayloadAction<SettingsState>) {
      return { ...action.payload, hydrated: true };
    },
    /** Nothing stored (first visit) — defaults stand, but loading is done. */
    markSettingsHydrated(state) {
      state.hydrated = true;
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
  markSettingsHydrated,
  setMarketLeverage,
  toggleFavouriteMarket,
} = settingsSlice.actions;
export { initialState as defaultSettings };
export default settingsSlice.reducer;
