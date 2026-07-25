import type { AppDispatch } from "@/store";
import { addTrade } from "@/store/slices/historySlice";
import { roi } from "@/lib/perp";
import type { CompletedTrade, Position } from "@/types";

// Build a CompletedTrade from a position + its exit and log it to the history
// slice. `pnl` is the realized PnL at close (may be a partial for reductions,
// but for full close it's the position's unrealized PnL at exit).
export function recordClose(
  dispatch: AppDispatch,
  position: Position,
  exitPrice: number,
  pnl: number
) {
  const now = Date.now();
  const trade: CompletedTrade = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    symbol: position.symbol,
    direction: position.direction,
    entryPrice: position.entryPrice,
    exitPrice,
    leverage: position.leverage,
    size: position.size,
    pnl,
    roi: roi(pnl, position.marginUsed),
    durationMs: now - position.openedAt,
    openedAt: position.openedAt,
    closedAt: now,
  };
  dispatch(addTrade(trade));
  return trade;
}
