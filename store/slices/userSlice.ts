import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { Balance } from "@/types";

// Wallet identity + live balance. Balance is fed by the Bulk account WS margin
// channel; walletAddress comes from Privy after connect.
interface UserState {
  walletAddress: string | null;
  connected: boolean;
  balance: Balance | null;
}

const initialState: UserState = {
  walletAddress: null,
  connected: false,
  balance: null,
};

const userSlice = createSlice({
  name: "user",
  initialState,
  reducers: {
    setWallet(state, action: PayloadAction<string | null>) {
      state.walletAddress = action.payload;
      state.connected = action.payload !== null;
    },
    setBalance(state, action: PayloadAction<Balance | null>) {
      state.balance = action.payload;
    },
    /**
     * Merge only the margin fields we actually received. Bulk's `marginUpdate`
     * deltas are partial (often just `unrealizedPnl`), so a plain replace would
     * blank out `equity` and collapse the displayed balance to the PnL alone.
     * The WS layer already merges; this keeps any other partial writer safe too.
     */
    mergeBalance(state, action: PayloadAction<Partial<Balance>>) {
      if (!state.balance) {
        const { equity, available, marginUsed } = action.payload;
        // Nothing to merge into yet — only accept a write that establishes the
        // base figures, otherwise we'd invent an equity of 0.
        if (equity == null || available == null || marginUsed == null) return;
        state.balance = action.payload as Balance;
        return;
      }
      for (const [k, v] of Object.entries(action.payload)) {
        if (v !== undefined) {
          (state.balance as Record<string, unknown>)[k] = v;
        }
      }
    },
  },
});

export const { setWallet, setBalance, mergeBalance } = userSlice.actions;
export default userSlice.reducer;
