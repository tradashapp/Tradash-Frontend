import type { AppStore } from "./index";
import {
  defaultSettings,
  hydrateSettings,
  type SettingsState,
} from "./slices/settingsSlice";
import { hydrateHistory } from "./slices/historySlice";
import type { CompletedTrade } from "@/types";

const SETTINGS_KEY = "tradash.settings.v1";
const HISTORY_KEY = "tradash.history.v1";

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

  // Hydrate history.
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (raw) {
      store.dispatch(hydrateHistory(JSON.parse(raw) as CompletedTrade[]));
    }
  } catch {
    /* corrupt storage — keep empty */
  }

  let lastSettings = store.getState().settings;
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
        window.localStorage.setItem(
          HISTORY_KEY,
          JSON.stringify(state.history.trades)
        );
      } catch {
        /* non-fatal */
      }
    }
  });
}
