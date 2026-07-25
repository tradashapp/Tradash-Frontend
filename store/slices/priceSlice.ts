import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol } from "@/types";

// NOTE: the oracle streams at 50-200ms. The raw stream writes into a mutable
// buffer (lib/oracle) and the chart reads that buffer directly for 60fps. This
// slice holds the *committed* price that Redux-connected UI (header, PnL calc)
// reads — updated on a throttled rAF cadence by the live middleware, so it is
// live but never thrashes rerenders.
interface PriceState {
  /** Latest committed price per market. */
  prices: Partial<Record<MarketSymbol, number>>;
  /** ms epoch of last commit, for staleness UI. */
  updatedAt: Partial<Record<MarketSymbol, number>>;
}

const initialState: PriceState = {
  prices: {},
  updatedAt: {},
};

const priceSlice = createSlice({
  name: "price",
  initialState,
  reducers: {
    commitPrice(
      state,
      action: PayloadAction<{ symbol: MarketSymbol; price: number; at: number }>
    ) {
      const { symbol, price, at } = action.payload;
      state.prices[symbol] = price;
      state.updatedAt[symbol] = at;
    },
  },
});

export const { commitPrice } = priceSlice.actions;
export default priceSlice.reducer;
