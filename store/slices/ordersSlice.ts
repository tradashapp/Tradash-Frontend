import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { LimitOrder } from "@/types";

// Resting LIVE limit orders, as Bulk reports them. Bulk is the source of truth:
// `setOpenOrders` replaces the whole list from each /account read, so an order
// that filled or was cancelled elsewhere (another device, bulk.trade) drops out
// on the next refresh. `addOpenOrder` is only the optimistic bridge between a
// successful placement and that refresh, so the chart line appears on the tap.
interface OrdersState {
  open: LimitOrder[];
}

const initialState: OrdersState = { open: [] };

const ordersSlice = createSlice({
  name: "orders",
  initialState,
  reducers: {
    setOpenOrders(state, action: PayloadAction<LimitOrder[]>) {
      state.open = action.payload;
    },
    addOpenOrder(state, action: PayloadAction<LimitOrder>) {
      if (!state.open.some((o) => o.orderId === action.payload.orderId)) {
        state.open.push(action.payload);
      }
    },
    removeOpenOrder(state, action: PayloadAction<string>) {
      state.open = state.open.filter((o) => o.orderId !== action.payload);
    },
  },
});

export const { setOpenOrders, addOpenOrder, removeOpenOrder } =
  ordersSlice.actions;
export default ordersSlice.reducer;
