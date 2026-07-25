import type { AppStore } from "./index";
import {
  defaultSettings,
  hydrateSettings,
  type SettingsState,
} from "./slices/settingsSlice";

const KEY = "tradash.settings.v1";

// Load persisted settings on the client and subscribe to persist future
// changes. Called once from the Providers after the store is created.
export function wireSettingsPersistence(store: AppStore) {
  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      store.dispatch(hydrateSettings({ ...defaultSettings, ...parsed }));
    }
  } catch {
    // Corrupt storage — ignore and keep defaults.
  }

  let last = store.getState().settings;
  store.subscribe(() => {
    const next = store.getState().settings;
    if (next !== last) {
      last = next;
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Storage full / disabled — non-fatal.
      }
    }
  });
}
