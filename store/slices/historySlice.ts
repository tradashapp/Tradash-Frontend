import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CompletedTrade } from "@/types";

// Completed-trade log. Demo trades live here (persisted to localStorage); live
// trades are also mirrored here for instant display and sent to the backend.
interface HistoryState {
  trades: CompletedTrade[];
}

const initialState: HistoryState = { trades: [] };

const historySlice = createSlice({
  name: "history",
  initialState,
  reducers: {
    addTrade(state, action: PayloadAction<CompletedTrade>) {
      state.trades.unshift(action.payload);
    },
    hydrateHistory(_state, action: PayloadAction<CompletedTrade[]>) {
      return { trades: action.payload };
    },
    clearHistory(state) {
      state.trades = [];
    },
  },
});

export const { addTrade, hydrateHistory, clearHistory } = historySlice.actions;
export default historySlice.reducer;
