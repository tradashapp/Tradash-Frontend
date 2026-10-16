import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { MarketSymbol, OrderStatus } from "@/types";

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
  /**
   * MagicBlock price captured the instant UP/DOWN is tapped, per symbol. Used
   * purely to draw the live entry line where the user clicked on the chart
   * (PnL comes from Bulk). Consumed when the live position first appears.
   */
  pendingChartEntry: Partial<Record<string, number>>;
  /**
   * Limit-order draft. When `enabled`, UP/DOWN place a resting limit at
   * `price[symbol]` instead of a market order, and tapping the chart sets that
   * price. Deliberately NOT persisted: a limit armed in a past session, at a
   * price the market has long left, is not something to wake up to.
   */
  limit: {
    enabled: boolean;
    /** Draft price per market, in chart space (= Bulk space on the Bulk feed). */
    price: Partial<Record<MarketSymbol, number>>;
  };
}

const initialState: TradingState = {
  orderStatus: "idle",
  lastError: null,
  agentAuthorized: false,
  builderApproved: false,
  pendingChartEntry: {},
  limit: { enabled: false, price: {} },
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
    /** Stash the tap-time MagicBlock price for a symbol (chart entry line). */
    setPendingChartEntry(
      state,
      action: PayloadAction<{ symbol: string; price: number }>
    ) {
      state.pendingChartEntry[action.payload.symbol] = action.payload.price;
    },
    clearPendingChartEntry(state, action: PayloadAction<string>) {
      delete state.pendingChartEntry[action.payload];
    },
    setLimitEnabled(state, action: PayloadAction<boolean>) {
      state.limit.enabled = action.payload;
    },
    /** Set (or clear, with null) one market's draft limit price. */
    setLimitPrice(
      state,
      action: PayloadAction<{ symbol: MarketSymbol; price: number | null }>
    ) {
      const { symbol, price } = action.payload;
      if (price == null || !(price > 0)) delete state.limit.price[symbol];
      else state.limit.price[symbol] = price;
    },
  },
});

export const {
  setOrderStatus,
  setOrderError,
  setAgentAuthorized,
  setBuilderApproved,
  setPendingChartEntry,
  clearPendingChartEntry,
  setLimitEnabled,
  setLimitPrice,
} = tradingSlice.actions;
export default tradingSlice.reducer;
