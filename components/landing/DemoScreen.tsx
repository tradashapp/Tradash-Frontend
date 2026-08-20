"use client";

import { useCallback, useRef } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  ArrowDown01Icon as ChevronIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { Odometer } from "@/components/ui/Odometer";
import { formatUsd } from "@/lib/format";
import { DEMO_LEVERAGE, DEMO_SIZE } from "@/lib/landing/demoMachine";
import type { DemoTrade } from "@/hooks/useDemoTrade";
import type { ChartFrame } from "@/lib/chart/engine";

interface Props {
  demo: DemoTrade;
}

// The app screen as it appears inside the phone mockup: the same dot grid,
// chart, market header, balance pill and UP/DOWN cluster as MobileLayout — but
// wired to the simulated demo, and with only UP/DOWN interactive. The chrome
// (market header, balance pill) is presentational here: it renders identically
// to the real app but isn't clickable, per the brief.
export function DemoScreen({ demo }: Props) {
  const gridRef = useRef<DotGridHandle | null>(null);
  const handleFrame = useCallback((f: ChartFrame) => {
    gridRef.current?.react(f);
  }, []);

  const { position, autoPressing } = demo;
  const inPosition = position != null;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-bg">
      <div className="pointer-events-none absolute inset-0 z-0">
        <DotGrid ref={gridRef} ignoreSplash />
      </div>
      <div className="absolute inset-0 z-10">
        <CanvasChart
          symbol="BTC"
          position={demo.chartPosition}
          externalPrice={demo.price}
          onFrame={handleFrame}
          ignoreSplash
        />
      </div>

      {/* Header — market identity + balance, matching the real app's layout. */}
      <header className="relative z-20 flex items-start justify-between px-2.5 pt-3">
        <div className="flex items-center gap-2 rounded-full bg-bg-overlay/50 px-1.5 py-1">
          <Image
            src="/images/crypto/btc.png"
            alt="Bitcoin"
            width={40}
            height={40}
            className="h-6 w-6 rounded-full"
          />
          <div className="leading-tight">
            <div className="flex items-center gap-0.5">
              <Odometer
                value={formatUsd(demo.price)}
                className="text-[13px] font-semibold"
              />
              <HugeiconsIcon
                icon={ChevronIcon}
                size={12}
                className="text-text-muted"
              />
            </div>
            <div className="text-[9px] text-text-muted">BTC · Bitcoin</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-full bg-bg-overlay/60 px-2.5 py-1.5 backdrop-blur-sm">
          <HugeiconsIcon icon={Wallet01Icon} size={13} className="text-up" />
          <Odometer
            value={formatUsd(demo.balance + (position?.pnl ?? 0))}
            className="text-[12px] font-semibold"
          />
        </div>
      </header>

      <div className="pointer-events-none relative z-20 flex-1" />

      {/* Trade controls. Only UP/DOWN respond to input — the rest of the demo
          drives itself. While a position is open the buttons show its live PnL
          instead of switching to the app's Trail/Close pair, so the mockup
          never presents an action the visitor can't take. */}
      <footer className="relative z-20 px-3 pb-4">
        {!inPosition ? (
          <div className="grid grid-cols-2 gap-2">
            <DemoButton
              direction="long"
              pressed={autoPressing === "long"}
              onPress={demo.openLong}
            />
            <DemoButton
              direction="short"
              pressed={autoPressing === "short"}
              onPress={demo.openShort}
            />
          </div>
        ) : (
          <LivePnl direction={position.direction} pnl={position.pnl} />
        )}
      </footer>
    </div>
  );
}

// UP / DOWN. `pressed` is the synthetic press the idle demo performs — it drives
// the same scale + brightness the real button shows under a finger, so an
// unattended visitor sees the tap happen rather than the position appearing from
// nowhere.
function DemoButton({
  direction,
  pressed,
  onPress,
}: {
  direction: "long" | "short";
  pressed: boolean;
  onPress: () => void;
}) {
  const up = direction === "long";
  return (
    <button
      type="button"
      onClick={onPress}
      className={`flex items-center justify-center gap-1.5 rounded-full py-3.5 text-[15px] font-semibold backdrop-blur-sm transition-all duration-200 ease-snap active:scale-95 ${
        up ? "bg-up-soft text-up" : "bg-down-soft text-down"
      } ${
        pressed
          ? up
            ? "scale-95 bg-up/30 shadow-[0_0_28px_rgba(114,233,18,0.35)]"
            : "scale-95 bg-down/30 shadow-[0_0_28px_rgba(230,67,45,0.35)]"
          : ""
      }`}
    >
      <HugeiconsIcon icon={up ? ArrowUp01Icon : ArrowDown01Icon} size={17} />
      {up ? "UP" : "DOWN"}
    </button>
  );
}

// Replaces the buttons while the demo position runs: direction, size and the
// live profit ticking up.
function LivePnl({
  direction,
  pnl,
}: {
  direction: "long" | "short";
  pnl: number;
}) {
  const up = direction === "long";
  return (
    <div className="glass flex items-center gap-2.5 rounded-full px-3.5 py-3">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full ${
          up ? "bg-up-soft text-up" : "bg-down-soft text-down"
        }`}
      >
        <HugeiconsIcon icon={up ? ArrowUp01Icon : ArrowDown01Icon} size={14} />
      </span>
      <div className="leading-tight">
        <div className="text-[12px] font-semibold">
          {up ? "Long" : "Short"} BTC
        </div>
        <div className="text-[9px] text-text-muted">
          ${DEMO_SIZE} · {DEMO_LEVERAGE}x
        </div>
      </div>
      <span className="ml-auto text-[15px] font-bold text-up">
        <Odometer value={`+$${pnl.toFixed(2)}`} />
      </span>
    </div>
  );
}
