import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { TradeEpisode } from "@/types";

// Recorded position paths, keyed by episode id. Several history rows (open /
// add / reduce / close) reference the SAME episode — a position lifecycle is
// one continuous recording — so this is stored separately from the trade log
// rather than duplicated onto each row.
//
// Demo episodes persist to their own localStorage key; live episodes come from
// the backend. See store/persist.ts for why the key is separate from history.
interface ReplayState {
  byId: Record<string, TradeEpisode>;
}

const initialState: ReplayState = { byId: {} };

/**
 * Cap on retained episodes. At ~1.2-4.3KB each this keeps the demo store around
 * 0.6MB of a typical 5MB origin quota, leaving ample headroom for settings and
 * the trade log itself.
 */
export const MAX_EPISODES = 150;

/** Drop the oldest episodes until at most MAX_EPISODES remain. */
function evict(byId: Record<string, TradeEpisode>) {
  const ids = Object.keys(byId);
  if (ids.length <= MAX_EPISODES) return;
  const ordered = ids.sort(
    (a, b) => (byId[a]!.closedAt ?? 0) - (byId[b]!.closedAt ?? 0)
  );
  for (const id of ordered.slice(0, ids.length - MAX_EPISODES)) {
    delete byId[id];
  }
}

const replaySlice = createSlice({
  name: "replay",
  initialState,
  reducers: {
    addEpisode(state, action: PayloadAction<TradeEpisode>) {
      state.byId[action.payload.id] = action.payload;
      evict(state.byId);
    },
    /** Replace the whole set (hydrating persisted demo episodes on load). */
    hydrateEpisodes(_state, action: PayloadAction<TradeEpisode[]>) {
      const byId: Record<string, TradeEpisode> = {};
      for (const ep of action.payload) byId[ep.id] = ep;
      evict(byId);
      return { byId };
    },
    /** Merge the backend's live episodes in, preserving demo ones. */
    hydrateLiveEpisodes(state, action: PayloadAction<TradeEpisode[]>) {
      const byId: Record<string, TradeEpisode> = {};
      for (const ep of Object.values(state.byId)) {
        if (ep.mode === "demo") byId[ep.id] = ep;
      }
      for (const ep of action.payload) byId[ep.id] = ep;
      evict(byId);
      return { byId };
    },
    clearEpisodes() {
      return { byId: {} };
    },
  },
});

export const {
  addEpisode,
  hydrateEpisodes,
  hydrateLiveEpisodes,
  clearEpisodes,
} = replaySlice.actions;
export default replaySlice.reducer;
