import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol } from "@/types";
import { DEFAULT_MARKET } from "@/lib/markets";

interface MarketState {
  active: MarketSymbol;
  /** True during the swap so the UI can animate the transition. */
  switching: boolean;
}

const initialState: MarketState = {
  active: DEFAULT_MARKET,
  switching: false,
};

const marketSlice = createSlice({
  name: "market",
  initialState,
  reducers: {
    startSwitch(state, action: PayloadAction<MarketSymbol>) {
      if (action.payload === state.active) return;
      state.switching = true;
      state.active = action.payload;
    },
    finishSwitch(state) {
      state.switching = false;
    },
  },
});

export const { startSwitch, finishSwitch } = marketSlice.actions;
export default marketSlice.reducer;
