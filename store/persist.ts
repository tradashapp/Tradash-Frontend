import type { AppStore } from "./index";
import {
  defaultSettings,
  hydrateSettings,
  type SettingsState,
} from "./slices/settingsSlice";
import { hydrateHistory } from "./slices/historySlice";
import {
  hydrateTradingMode,
  type TradingMode,
} from "./slices/tradingModeSlice";
import type { CompletedTrade } from "@/types";

const SETTINGS_KEY = "tradash.settings.v1";
const HISTORY_KEY = "tradash.history.v1";
const MODE_KEY = "tradash.mode.v1";

// Load persisted settings + trade history on the client and subscribe to
// persist future changes. Called once from Providers after the store is created.
export function wireSettingsPersistence(store: AppStore) {
  if (typeof window === "undefined") return;

  // Hydrate settings.
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      store.dispatch(hydrateSettings({ ...defaultSettings, ...parsed }));
    }
  } catch {
    /* corrupt storage — keep defaults */
  }

  // Hydrate history. Only demo trades are persisted locally; live trades come
  // from the backend on login. Filter defensively in case an older build wrote
  // untagged or live rows to this key.
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const parsed = (JSON.parse(raw) as CompletedTrade[]).filter(
        (t) => t.mode === "demo"
      );
      store.dispatch(hydrateHistory(parsed));
    }
  } catch {
    /* corrupt storage — keep empty */
  }

  // Hydrate trading mode (demo/live) + demo balance. Open positions are NOT
  // persisted — they come from Bulk (live) or start flat (demo).
  try {
    const raw = window.localStorage.getItem(MODE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        mode?: TradingMode;
        demoBalance?: number;
      };
      store.dispatch(
        hydrateTradingMode({
          mode: parsed.mode === "live" ? "live" : "demo",
          demoBalance:
            typeof parsed.demoBalance === "number"
              ? parsed.demoBalance
              : store.getState().tradingMode.demo.balance,
        })
      );
    }
  } catch {
    /* corrupt storage — keep defaults */
  }

  let lastSettings = store.getState().settings;
  let lastMode = store.getState().tradingMode.mode;
  let lastDemoBalance = store.getState().tradingMode.demo.balance;
  let lastHistory = store.getState().history.trades;
  store.subscribe(() => {
    const state = store.getState();
    if (state.settings !== lastSettings) {
      lastSettings = state.settings;
      try {
        window.localStorage.setItem(
          SETTINGS_KEY,
          JSON.stringify(state.settings)
        );
      } catch {
        /* non-fatal */
      }
    }
    if (state.history.trades !== lastHistory) {
      lastHistory = state.history.trades;
      try {
        // Persist demo trades only — live history is owned by the backend.
        window.localStorage.setItem(
          HISTORY_KEY,
          JSON.stringify(state.history.trades.filter((t) => t.mode === "demo"))
        );
      } catch {
        /* non-fatal */
      }
    }
    // Persist mode + demo balance when either changes.
    const mode = state.tradingMode.mode;
    const demoBalance = state.tradingMode.demo.balance;
    if (mode !== lastMode || demoBalance !== lastDemoBalance) {
      lastMode = mode;
      lastDemoBalance = demoBalance;
      try {
        window.localStorage.setItem(
          MODE_KEY,
          JSON.stringify({ mode, demoBalance })
        );
      } catch {
        /* non-fatal */
      }
    }
  });
}
