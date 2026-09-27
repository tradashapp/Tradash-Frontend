"use client";

import { useEffect, useState } from "react";
import { api, type FeeArrangement } from "@/lib/api";
import { feeArrangementOwner, refreshFeeArrangement } from "@/lib/bulk/feeArrangement";
import { MenuSection } from "@/components/ui/MenuSection";

// The user's Tradash fee, and where they redeem a fee code. Only Tradash's
// builder fee is shown or changed here; Bulk's own exchange fee is separate
// and unaffected, which the copy says plainly.
export function FeeCodeSection() {
  const privyId = feeArrangementOwner();
  const [fee, setFee] = useState<FeeArrangement | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!privyId) return;
    api.feeArrangement(privyId).then(setFee).catch(() => setFee(null));
  }, [privyId]);

  if (!privyId) return null;

  const redeem = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const next = await api.redeemFeeCode(privyId, code.trim());
      setFee(next);
      setCode("");
      // Orders pick up the new rate straight away.
      void refreshFeeArrangement();
      setMessage({ ok: true, text: `Code applied: ${next.effectiveFeeBps} bps Tradash fee.` });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "Couldn't apply the code." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <MenuSection title="Trading fees" className="mb-4">
      <div className="px-4 py-3.5">
        <div className="flex items-center justify-between">
          <div className="leading-tight">
            <div className="text-sm font-medium">Tradash fee</div>
            <div className="text-xs text-text-muted">
              {fee?.source === "code" ? `Code ${fee.code} applied` : "Standard rate"} · Bulk&apos;s exchange fee is separate
            </div>
          </div>
          <span className="tabular text-sm font-semibold">{fee ? `${fee.effectiveFeeBps} bps` : "—"}</span>
        </div>
        {fee?.source !== "code" && (
          <div className="mt-3 flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Fee code"
              maxLength={32}
              className="glass-inset min-w-0 flex-1 rounded-xl px-3 py-2 text-sm uppercase outline-none placeholder:normal-case placeholder:text-text-muted/60"
            />
            <button
              type="button"
              disabled={busy || code.trim().length < 3}
              onClick={redeem}
              className="rounded-xl bg-up px-4 text-sm font-bold text-black transition-transform active:scale-95 disabled:opacity-40"
            >
              {busy ? "…" : "Apply"}
            </button>
          </div>
        )}
        {message && <p className={`mt-2 text-xs ${message.ok ? "text-up" : "text-down"}`}>{message.text}</p>}
      </div>
    </MenuSection>
  );
}
