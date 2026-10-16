import { configureStore } from "@reduxjs/toolkit";
import market from "./slices/marketSlice";
import price from "./slices/priceSlice";
import position from "./slices/positionSlice";
import user from "./slices/userSlice";
import trading from "./slices/tradingSlice";
import orders from "./slices/ordersSlice";
import tradingMode from "./slices/tradingModeSlice";
import settings from "./slices/settingsSlice";
import history from "./slices/historySlice";
import replay from "./slices/replaySlice";

export const makeStore = () =>
  configureStore({
    reducer: {
      market,
      price,
      position,
      user,
      trading,
      orders,
      tradingMode,
      settings,
      history,
      replay,
    },
    // Live-price commits fire often; leave the default middleware but keep
    // serializable checks lenient in dev-heavy paths later if needed.
    middleware: (getDefault) => getDefault(),
  });

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<AppStore["getState"]>;
export type AppDispatch = AppStore["dispatch"];
