import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { OrderStatus } from "@/types";

// In-flight order state + one-time onboarding authorizations. Both onboarding
// steps require a MASTER-account signature (Bulk rule): the agent wallet lets us
// sign trades without a popup, and the `abc` builder-code approval lets our
// builder fee settle. Neither is done by the agent key.
interface TradingState {
  orderStatus: OrderStatus;
  lastError: string | null;
  /** Agent session key authorized (agentWalletCreation signed). */
  agentAuthorized: boolean;
  /** Builder code approved by master account (abc signed) — required for revenue. */
  builderApproved: boolean;
}

const initialState: TradingState = {
  orderStatus: "idle",
  lastError: null,
  agentAuthorized: false,
  builderApproved: false,
};

const tradingSlice = createSlice({
  name: "trading",
  initialState,
  reducers: {
    setOrderStatus(state, action: PayloadAction<OrderStatus>) {
      state.orderStatus = action.payload;
      if (action.payload !== "error" && action.payload !== "rejected") {
        state.lastError = null;
      }
    },
    setOrderError(state, action: PayloadAction<string>) {
      state.orderStatus = "error";
      state.lastError = action.payload;
    },
    setAgentAuthorized(state, action: PayloadAction<boolean>) {
      state.agentAuthorized = action.payload;
    },
    setBuilderApproved(state, action: PayloadAction<boolean>) {
      state.builderApproved = action.payload;
    },
  },
});

export const {
  setOrderStatus,
  setOrderError,
  setAgentAuthorized,
  setBuilderApproved,
} = tradingSlice.actions;
export default tradingSlice.reducer;
