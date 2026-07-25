import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Position } from "@/types";

// Fed by the Bulk account WS (no signature required to subscribe). Holds the
// single open position for the active account, or null when flat.
interface PositionState {
  current: Position | null;
}

const initialState: PositionState = {
  current: null,
};

const positionSlice = createSlice({
  name: "position",
  initialState,
  reducers: {
    setPosition(state, action: PayloadAction<Position | null>) {
      state.current = action.payload;
    },
    // Partial live update from a WS position delta (PnL, liq price, etc.).
    patchPosition(state, action: PayloadAction<Partial<Position>>) {
      if (!state.current) return;
      state.current = { ...state.current, ...action.payload };
    },
    clearPosition(state) {
      state.current = null;
    },
  },
});

export const { setPosition, patchPosition, clearPosition } =
  positionSlice.actions;
export default positionSlice.reducer;
