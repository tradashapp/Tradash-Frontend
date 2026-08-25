import type { AppStore } from "./index";
import {
  defaultSettings,
  hydrateSettings,
  type SettingsState,
} from "./slices/settingsSlice";
import { hydrateHistory } from "./slices/historySlice";
import { hydrateEpisodes, MAX_EPISODES } from "./slices/replaySlice";
import {
  hydrateTradingMode,
  type TradingMode,
} from "./slices/tradingModeSlice";
import { isMarketSymbol } from "@/lib/markets";
import type { CompletedTrade, TradeEpisode } from "@/types";

const SETTINGS_KEY = "tradash.settings.v1";
const HISTORY_KEY = "tradash.history.v1";
const MODE_KEY = "tradash.mode.v1";
// Replay paths live under their OWN key, deliberately not inside the history
// blob. Paths are orders of magnitude larger than trade rows, so sharing a key
// would mean one quota failure silently stops persisting trade history too —
// and the writes below swallow errors by design. Replay is a nice-to-have;
// trade history is not. They must be able to fail independently.
const REPLAY_KEY = "tradash.replays.v1";
/** Byte budget for stored replays (~1.5MB of a typical 5MB origin quota). */
const REPLAY_BUDGET_BYTES = 1_500_000;

// Load persisted settings + trade history on the client and subscribe to
// persist future changes. Called once from Providers after the store is created.
export function wireSettingsPersistence(store: AppStore) {
  if (typeof window === "undefined") return;

  // Hydrate settings.
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      const merged = { ...defaultSettings, ...parsed };
      // Favourites were added after v1 shipped; drop anything that isn't a
      // list of markets we still support so the switcher can't render a
      // dead row (Bulk delists, or a feed we pulled for lacking an oracle).
      merged.favouriteMarkets = Array.isArray(parsed.favouriteMarkets)
        ? parsed.favouriteMarkets.filter(
            (s): s is string => typeof s === "string" && isMarketSymbol(s)
          )
        : [];
      store.dispatch(hydrateSettings(merged));
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

  // Hydrate demo replay episodes. Live episodes come from the backend.
  try {
    const raw = window.localStorage.getItem(REPLAY_KEY);
    if (raw) {
      const parsed = (JSON.parse(raw) as TradeEpisode[]).filter(
        (e) => e && e.mode === "demo" && e.path
      );
      store.dispatch(hydrateEpisodes(parsed));
    }
  } catch {
    /* corrupt storage — replays are optional, keep empty */
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

  let lastReplays = store.getState().replay.byId;
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
    if (state.replay.byId !== lastReplays) {
      lastReplays = state.replay.byId;
      persistReplays(Object.values(state.replay.byId));
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

/**
 * Persist demo replay episodes, newest first, within a byte budget.
 *
 * Unlike the other writers this does NOT silently swallow a quota failure:
 * dropping the oldest episodes and retrying is almost always enough, and if it
 * still fails we give up on replays entirely rather than let the exception
 * bubble into the store subscription (which would take the other writers with
 * it on every subsequent dispatch).
 */
function persistReplays(all: TradeEpisode[]) {
  const demo = all
    .filter((e) => e.mode === "demo")
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0))
    .slice(0, MAX_EPISODES);

  // Trim to the byte budget before attempting the write, so the common case
  // never hits the exception path at all.
  let batch = demo;
  let payload = JSON.stringify(batch);
  while (batch.length > 1 && payload.length > REPLAY_BUDGET_BYTES) {
    batch = batch.slice(0, Math.floor(batch.length / 2));
    payload = JSON.stringify(batch);
  }

  try {
    window.localStorage.setItem(REPLAY_KEY, payload);
    return;
  } catch {
    /* quota — fall through to a smaller retry */
  }

  // Retry once with a much smaller set; if that fails too, clear the key so a
  // stale oversized blob doesn't keep occupying the quota that trade history
  // and settings need.
  try {
    const few = demo.slice(0, 20);
    window.localStorage.setItem(REPLAY_KEY, JSON.stringify(few));
  } catch {
    try {
      window.localStorage.removeItem(REPLAY_KEY);
    } catch {
      /* nothing further we can do — history/settings still persist */
    }
  }
}
