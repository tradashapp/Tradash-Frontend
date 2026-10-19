import type { SignalVerdict } from "@/lib/api";
import { MARKETS } from "@/lib/markets";
import type { MarketSymbol } from "@/types";

export const VERDICT: Record<SignalVerdict, { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "bg-up-soft text-up" },
  caution: { label: "Caution", className: "bg-amber-400/15 text-amber-300" },
  rejected: { label: "Rejected", className: "bg-down-soft text-down" },
  veto: { label: "Blocked", className: "bg-down-soft text-down" },
};

/** Short label for a paper-tracked outcome. */
export const OUTCOME: Record<string, string> = {
  target: "Target",
  stop: "Stop",
  breakeven: "BE",
  trail: "Trail",
  timeout: "Time",
};

/** Bulk symbol ("BTC-USD") → this app's market, when the app lists it. */
export function marketOfBulk(bulkSymbol: string): MarketSymbol | null {
  const hit = (Object.keys(MARKETS) as MarketSymbol[]).find((m) => MARKETS[m].bulkSymbol === bulkSymbol);
  return hit ?? null;
}

export function fmtPx(p: number): string {
  const dp = p >= 1000 ? 0 : p >= 10 ? 2 : p >= 1 ? 3 : 4;
  return `$${p.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

export function fmtR(r: number): string {
  return `${r >= 0 ? "+" : "−"}${Math.abs(r).toFixed(2)}R`;
}

export function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
