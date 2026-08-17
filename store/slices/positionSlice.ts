import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol, Position } from "@/types";

// Live positions from the Bulk account WS, keyed BY MARKET — Bulk supports one
// position per market simultaneously, so each market's chart
// shows its own. `null`/absent for a symbol = flat on that market.
interface PositionState {
  bySymbol: Partial<Record<MarketSymbol, Position>>;
}

const initialState: PositionState = {
  bySymbol: {},
};

const positionSlice = createSlice({
  name: "position",
  initialState,
  reducers: {
    /** Set (or clear, when null) the position for one market. */
    setPosition(
      state,
      action: PayloadAction<{ symbol: MarketSymbol; position: Position | null }>
    ) {
      const { symbol, position } = action.payload;
      if (position) state.bySymbol[symbol] = position;
      else delete state.bySymbol[symbol];
    },
    /** Partial live update for one market's position (PnL, liq price, etc.). */
    patchPosition(
      state,
      action: PayloadAction<{ symbol: MarketSymbol; patch: Partial<Position> }>
    ) {
      const cur = state.bySymbol[action.payload.symbol];
      if (cur)
        state.bySymbol[action.payload.symbol] = {
          ...cur,
          ...action.payload.patch,
        };
    },
    /**
     * Reconcile the FULL set of open live positions from a Bulk snapshot: any
     * market not present in the incoming list is now flat.
     */
    reconcilePositions(state, action: PayloadAction<Position[]>) {
      const next: PositionState["bySymbol"] = {};
      for (const p of action.payload) next[p.symbol] = p;
      state.bySymbol = next;
    },
    clearAllPositions(state) {
      state.bySymbol = {};
    },
  },
});

export const {
  setPosition,
  patchPosition,
  reconcilePositions,
  clearAllPositions,
} = positionSlice.actions;
export default positionSlice.reducer;
