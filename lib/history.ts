import type { AppDispatch } from "@/store";
import { addTrade } from "@/store/slices/historySlice";
import { roi } from "@/lib/perp";
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
  };
  dispatch(addTrade(trade));
  return trade;
}
