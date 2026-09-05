import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CompletedTrade } from "@/types";

// Completed-trade log. Demo trades live here (persisted to localStorage); live
// trades are also mirrored here for instant display and sent to the backend.
interface HistoryState {
  trades: CompletedTrade[];
  /**
   * Whether the backend's live rows have been loaded for this session.
   *
   * Without it an empty `trades` is ambiguous, and the history panel rendered
   * "No trades yet. Tap UP or DOWN to start." at a user who has traded for
   * months, for as long as the fetch took. Demo-only users are hydrated
   * immediately (their rows come from localStorage, not the API).
   */
  liveHydrated: boolean;
}

const initialState: HistoryState = { trades: [], liveHydrated: false };

const historySlice = createSlice({
  name: "history",
  initialState,
  reducers: {
    addTrade(state, action: PayloadAction<CompletedTrade>) {
      state.trades.unshift(action.payload);
    },
    // Replace the whole log (used when hydrating persisted demo trades on load).
    hydrateHistory(state, action: PayloadAction<CompletedTrade[]>) {
      return { trades: action.payload, liveHydrated: state.liveHydrated };
    },
    // Swap in the backend's live rows while preserving demo trades. Merged and
    // re-sorted newest-first so a mixed store stays chronological.
    hydrateLiveHistory(state, action: PayloadAction<CompletedTrade[]>) {
      const demo = state.trades.filter((t) => t.mode === "demo");
      state.trades = [...demo, ...action.payload].sort(
        (a, b) => b.closedAt - a.closedAt
      );
      state.liveHydrated = true;
    },
    clearHistory(state) {
      state.trades = [];
    },
    /**
     * Mark live history as settled without rows — a signed-out user, or a fetch
     * that failed. The panel must fall back to its empty state rather than
     * spinning forever.
     */
    markLiveHydrated(state) {
      state.liveHydrated = true;
    },
  },
});

export const {
  addTrade,
  hydrateHistory,
  hydrateLiveHistory,
  clearHistory,
  markLiveHydrated,
} = historySlice.actions;
export default historySlice.reducer;
