"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Target02Icon } from "@hugeicons/core-free-icons";
import { api, type SignalView } from "@/lib/api";
import { useAppSelector } from "@/store/hooks";
import { useToast } from "@/components/toast/ToastProvider";
import { InfoTip } from "@/components/ui/InfoTip";
import type { useTrade } from "@/hooks/useTrade";
import { VERDICT, fmtPx, marketOfBulk } from "./format";

/**
 * A signal opened from a notification (`/trade/<COIN>?signal=<id>`), floating
 * over the trade screen. "Take" is the user's OWN order through the normal
 * flow — their per-market size and leverage — and the signal's stop and
 * target are attached as native TP/SL once the position exists.
 *
 * The TP/SL is applied from an EFFECT, not after awaiting the order:
 * `trade.setTpSl` reads positions from the render it came from, so the copy
 * held by the tap handler would never see the new position.
 */

const POSITION_WAIT_MS = 15_000;

export function SignalCard({
  privyId,
  signalId,
  trade,
  onDone,
}: {
  privyId: string;
  signalId: string;
  trade: ReturnType<typeof useTrade>;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [signal, setSignal] = useState<SignalView | null>(null);
  const [taking, setTaking] = useState(false);
  // Set once the order is sent on live: protection still to attach.
  const [pending, setPending] = useState<{ until: number } | null>(null);
  const applied = useRef(false);
  const symbol = signal ? marketOfBulk(signal.symbol) : null;
  const hasLivePosition = useAppSelector((s) => (symbol ? s.position.bySymbol[symbol] != null : false));

  useEffect(() => {
    if (!pending || !signal || !symbol || applied.current) return;
    const finish = () => {
      applied.current = true;
      void api.signalTaken(privyId, signal.id).catch(() => undefined);
      setPending(null);
      onDone();
    };
    if (hasLivePosition) {
      // Claimed BEFORE the call: `trade` changes every render, so this effect
      // re-runs while the order is in flight and must not send it twice.
      applied.current = true;
      void trade.setTpSl({ symbol, takeProfit: signal.target, stopLoss: signal.stop }).finally(finish);
      return;
    }
    const t = setTimeout(() => {
      // Also reached when the order itself was refused (that path toasted why).
      toast("TP/SL not attached", { type: "info", description: "If the trade opened, set TP/SL from the position." });
      finish();
    }, Math.max(0, pending.until - Date.now()));
    return () => clearTimeout(t);
  }, [pending, hasLivePosition, signal, symbol, trade, privyId, onDone, toast]);

  useEffect(() => {
    let live = true;
    api
      .signal(privyId, signalId)
      .then((s) => live && setSignal(s))
      .catch(() => {
        if (live) onDone();
      });
    return () => {
      live = false;
    };
  }, [privyId, signalId, onDone]);

  if (!signal) return null;
  const long = signal.direction === "long";
  const v = VERDICT[signal.verdict];
  const blocked = signal.verdict === "veto" || signal.verdict === "rejected";

  const take = async () => {
    if (!symbol || taking) return;
    if (trade.hasPosition) {
      toast(`You already have a ${symbol} position`, { type: "info" });
      return;
    }
    setTaking(true);
    try {
      await (long ? trade.openLong() : trade.openShort());
      if (trade.mode === "live") {
        setPending({ until: Date.now() + POSITION_WAIT_MS });
        return; // the effect attaches TP/SL, then closes the card
      }
      void api.signalTaken(privyId, signal.id).catch(() => undefined);
      onDone();
    } finally {
      setTaking(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="glass pointer-events-auto w-full max-w-sm rounded-2xl p-4"
    >
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={Target02Icon} size={16} className="text-text-muted" />
        <span className="flex-1 truncate text-sm font-semibold">
          {signal.symbol.replace(/-USD$/, "")} {long ? "Long" : "Short"} · {signal.presetLabel} {signal.timeframe}
        </span>
        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${v.className}`}>{v.label}</span>
        <button type="button" aria-label="Dismiss" onClick={onDone} className="text-text-muted hover:text-text">
          <HugeiconsIcon icon={Cancel01Icon} size={16} />
        </button>
      </div>

      <div className="tabular mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <Level label="Entry" value={fmtPx(signal.price)} />
        <Level label="SL" value={fmtPx(signal.stop)} tone="down" />
        <Level label="TP" value={fmtPx(signal.target)} tone="up" />
      </div>

      {signal.factors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {signal.factors
            .filter((f) => f.weight > 0 || f.key === "macro")
            .map((f) => (
              <span
                key={f.key}
                title={f.detail}
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  f.score > 0.15 ? "bg-up-soft text-up" : f.score < -0.15 ? "bg-down-soft text-down" : "bg-white/[0.06] text-text-muted"
                }`}
              >
                {f.label}
              </span>
            ))}
          <InfoTip label="Why">
            {signal.reason}.{signal.vetoReason ? ` Blocked: ${signal.vetoReason}.` : ""} Green supports the trade, red works against it.
          </InfoTip>
        </div>
      )}

      <button
        type="button"
        disabled={!symbol || signal.expired || blocked || taking || pending !== null}
        onClick={() => void take()}
        className={`mt-4 w-full rounded-xl py-3 text-sm font-bold text-bg transition-opacity disabled:opacity-40 ${long ? "bg-up" : "bg-down"}`}
      >
        {taking ? "Placing…" : pending ? "Setting TP/SL…" : signal.expired ? "Expired" : blocked ? v.label : `Take ${long ? "long" : "short"}`}
      </button>
    </motion.div>
  );
}

function Level({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="glass-inset rounded-xl py-2">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div className={`mt-0.5 font-semibold ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : ""}`}>{value}</div>
    </div>
  );
}
