import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Position } from "@/types";

// App-wide trading mode. Demo and Live coexist permanently; the user toggles
// between them from the Account sheet. Demo keeps its own balance + simulated
// position here so it never collides with the live user/position slices (which
// are fed by Bulk). Live PnL/balance live in those slices; demo lives here.

export type TradingMode = "demo" | "live";

const DEMO_STARTING_BALANCE = 10_000;

interface TradingModeState {
  mode: TradingMode;
  demo: {
    /** Realized balance; unrealized PnL is added on top for display. */
    balance: number;
    position: Position | null;
  };
}

const initialState: TradingModeState = {
  mode: "demo",
  demo: {
    balance: DEMO_STARTING_BALANCE,
    position: null,
  },
};

const tradingModeSlice = createSlice({
  name: "tradingMode",
  initialState,
  reducers: {
    setMode(state, action: PayloadAction<TradingMode>) {
      state.mode = action.payload;
    },
    setDemoPosition(state, action: PayloadAction<Position | null>) {
      state.demo.position = action.payload;
    },
    patchDemoPosition(state, action: PayloadAction<Partial<Position>>) {
      if (state.demo.position) {
        state.demo.position = { ...state.demo.position, ...action.payload };
      }
    },
    /** Apply realized PnL to the demo balance (on close). */
    settleDemo(state, action: PayloadAction<number>) {
      state.demo.balance += action.payload;
      state.demo.position = null;
    },
    resetDemo(state) {
      state.demo.balance = DEMO_STARTING_BALANCE;
      state.demo.position = null;
    },
    /** Restore persisted mode + demo balance on load (positions are not persisted). */
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
