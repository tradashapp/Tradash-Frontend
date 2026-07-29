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
    // Replace the whole log (used when hydrating persisted demo trades on load).
    hydrateHistory(_state, action: PayloadAction<CompletedTrade[]>) {
      return { trades: action.payload };
    },
    // Swap in the backend's live rows while preserving demo trades. Merged and
    // re-sorted newest-first so a mixed store stays chronological.
    hydrateLiveHistory(state, action: PayloadAction<CompletedTrade[]>) {
      const demo = state.trades.filter((t) => t.mode === "demo");
      state.trades = [...demo, ...action.payload].sort(
        (a, b) => b.closedAt - a.closedAt
      );
    },
    clearHistory(state) {
      state.trades = [];
    },
  },
});

export const { addTrade, hydrateHistory, hydrateLiveHistory, clearHistory } =
  historySlice.actions;
export default historySlice.reducer;
