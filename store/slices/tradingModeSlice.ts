import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol, Position } from "@/types";

// App-wide trading mode. Demo and Live coexist permanently; the user toggles
// between them from the Account sheet. Demo keeps its own balance + simulated
// positions here (keyed by market, like live) so it never collides with the live
// slices. Demo supports one position per market simultaneously, same as Bulk.

export type TradingMode = "demo" | "live";

const DEMO_STARTING_BALANCE = 10_000;

interface TradingModeState {
  mode: TradingMode;
  demo: {
    /** Realized balance; unrealized PnL is added on top for display. */
    balance: number;
    positions: Partial<Record<MarketSymbol, Position>>;
  };
}

const initialState: TradingModeState = {
  // Live is the default. New users can pick Demo from the "how it works" popup;
  // returning users get their last-used mode restored from localStorage.
  mode: "live",
  demo: {
    balance: DEMO_STARTING_BALANCE,
    positions: {},
  },
};

const tradingModeSlice = createSlice({
  name: "tradingMode",
  initialState,
  reducers: {
    setMode(state, action: PayloadAction<TradingMode>) {
      state.mode = action.payload;
    },
    setDemoPosition(
      state,
      action: PayloadAction<{ symbol: MarketSymbol; position: Position | null }>
    ) {
      const { symbol, position } = action.payload;
      if (position) state.demo.positions[symbol] = position;
      else delete state.demo.positions[symbol];
    },
    patchDemoPosition(
      state,
      action: PayloadAction<{ symbol: MarketSymbol; patch: Partial<Position> }>
    ) {
      const cur = state.demo.positions[action.payload.symbol];
      if (cur)
        state.demo.positions[action.payload.symbol] = {
          ...cur,
          ...action.payload.patch,
        };
    },
    /** Realize a market's PnL into the demo balance and clear that position. */
    settleDemo(
      state,
      action: PayloadAction<{ symbol: MarketSymbol; pnl: number }>
    ) {
      state.demo.balance += action.payload.pnl;
      delete state.demo.positions[action.payload.symbol];
    },
    resetDemo(state) {
      state.demo.balance = DEMO_STARTING_BALANCE;
      state.demo.positions = {};
    },
    /** Restore persisted mode + demo balance on load (positions not persisted). */
    hydrateTradingMode(
      state,
      action: PayloadAction<{ mode: TradingMode; demoBalance: number }>
    ) {
      state.mode = action.payload.mode;
      state.demo.balance = action.payload.demoBalance;
    },
  },
});

export const {
  setMode,
  setDemoPosition,
  patchDemoPosition,
  settleDemo,
  resetDemo,
  hydrateTradingMode,
} = tradingModeSlice.actions;
export { DEMO_STARTING_BALANCE };
export default tradingModeSlice.reducer;
