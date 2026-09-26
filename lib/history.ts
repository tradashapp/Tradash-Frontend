import type { AppDispatch } from "@/store";
import { addTrade } from "@/store/slices/historySlice";
import { addEpisode } from "@/store/slices/replaySlice";
import { episodeIdFor, sealEpisode } from "@/lib/replay/recorder";
import { roi } from "@/lib/perp";
import { findStopLoss, findTakeProfit } from "@/lib/bulk/protection";
import type {
  CompletedTrade,
  Position,
  TradeEventKind,
  TradingMode,
} from "@/types";

// Build a CompletedTrade from a position + its exit and log it to the history
// slice. `pnl` is the realized PnL for the event (0 for an `add`, the partial
// for a `reduce`, the full unrealized PnL for a `close`). `kind` tags the event
// (default `close`). `mode` tags the trade so demo (localStorage) and live
// (backend) history stay separable. `size` is the size the event touched.
export function recordClose(
  dispatch: AppDispatch,
  mode: TradingMode,
  position: Position,
  exitPrice: number,
  pnl: number,
  kind: TradeEventKind = "close",
  eventSize: number = position.size
) {
  const now = Date.now();
  const trade: CompletedTrade = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    mode,
    kind,
    // Tag the row with its recording BEFORE dispatching: Redux Toolkit freezes
    // the payload once it lands in the store, so assigning afterwards would be
    // silently dropped (and throw under dev's immutability check).
    episodeId: episodeIdFor(position.symbol),
    symbol: position.symbol,
    direction: position.direction,
    entryPrice: position.entryPrice,
    exitPrice,
    leverage: position.leverage,
    size: eventSize,
    pnl,
    // ROI is meaningful for realized events; for an `add` there's no realized
    // return, so report 0.
    roi: kind === "add" ? 0 : roi(pnl, position.marginUsed),
    durationMs: now - position.openedAt,
    openedAt: position.openedAt,
    closedAt: now,
    // What was resting on Bulk when it closed — shown on the details sheet.
    takeProfit: findTakeProfit(position.protection)?.triggerPrice ?? null,
    stopLoss: findStopLoss(position.protection)?.triggerPrice ?? null,
  };
  dispatch(addTrade(trade));

  // Seal the replay recording. Every call site funnels through here, so this is
  // the one place episode handling has to happen — the eleven close/add/reduce
  // sites across useTrade, useDemoPnl and useBulkAccount need no changes.
  //
  // An `add`/`reduce` tags its row but does NOT seal: a position lifecycle is
  // ONE continuous path, and those rows replay the same recording, seeking to
  // their own moment. Only a full `close` seals it.
  if (kind === "close") {
    const episode = sealEpisode(position.symbol, now);
    if (episode) dispatch(addEpisode(episode));
  }

  return trade;
}
