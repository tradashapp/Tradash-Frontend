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
  },
});

export const { setWallet, setBalance } = userSlice.actions;
export default userSlice.reducer;
