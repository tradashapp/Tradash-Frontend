"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  CheckmarkCircle02Icon,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

/** How long the copy button stays in its confirmed state before reverting. */
const COPIED_MS = 1800;

/**
 * Receive USDC into the user's own Solana wallet.
 *
 * This replaces the Privy on-ramp modal for the Deposit action: the wallet is a
 * plain Solana address, so the fastest path for a user who already holds USDC
 * somewhere else is to scan or paste it — not to be handed a card-purchase flow
 * they have to back out of.
 *
 * The QR encodes the BARE address rather than a `solana:` payment URI. Wallet
 * apps all parse a raw address, whereas URI support is uneven, and a scan that
 * silently fails is worse than one that lands in the send screen with the
 * recipient pre-filled.
 */
export function DepositPanel({ address }: { address: string | null }) {
  const [copied, setCopied] = useState(false);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);

  // Encode the QR whenever the address resolves. Generated locally into a data
  // URL — an image service would leak the user's address to a third party.
  // `toDataURL` rather than `toCanvas` because the browser build of `qrcode`
  // only ships the former, and it sidesteps ref-timing against the render.
  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    QRCode.toDataURL(address, {
      width: 200,
      margin: 1,
      // A white quiet zone regardless of the app's dark surface: scanners key
      // off the light/dark contrast, and an inverted code reads unreliably.
      color: { dark: "#08090c", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (cancelled) return;
        setQrSrc(url);
        setQrFailed(false);
      })
      .catch(() => {
        // The address still copies, so a failed encode degrades rather than
        // blocking the deposit.
        if (!cancelled) setQrFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [address]);

  // Revert the copied confirmation on its own timer.
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    if (!address) return;
    playSound("tap");
    haptic("tap");
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard is unavailable (insecure context, or permission refused).
      // The address is on screen in full, so it stays selectable by hand.
      setCopied(false);
    }
  };

  if (!address) {
    return (
      <p className="py-10 text-center text-sm text-text-muted">
        Connecting your wallet&hellip;
      </p>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <h2 className="px-4 text-center text-base font-semibold leading-snug">
        Send USDC on Solana to this address
      </h2>

      {/* QR. The white plate is part of the code's quiet zone, not decoration. */}
      <div className="mt-5 rounded-2xl bg-white p-3">
        {qrFailed ? (
          <div className="flex h-[200px] w-[200px] items-center justify-center px-4 text-center text-xs text-black/60">
            Couldn&rsquo;t draw the QR code — copy the address below instead.
          </div>
        ) : qrSrc ? (
          /* eslint-disable-next-line @next/next/no-img-element -- a data URL,
             so next/image would have nothing to optimise. */
          <img
            src={qrSrc}
            alt="QR code of your Solana deposit address"
            className="block h-[200px] w-[200px]"
          />
        ) : (
          <div className="h-[200px] w-[200px] animate-pulse rounded bg-black/5" />
        )}
      </div>

      {/* The address in full, wrapped rather than truncated: a user checking it
          against their sending wallet needs to read every character. */}
      <button
        type="button"
        onClick={onCopy}
        aria-label="Copy deposit address"
        className="glass-inset mt-4 flex w-full items-center gap-3 rounded-2xl p-3.5 text-left transition-colors hover:bg-white/[0.04] active:scale-[0.99]"
      >
        <span className="min-w-0 flex-1 break-all font-mono text-[13px] leading-relaxed">
          {address}
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full">
          <HugeiconsIcon
            icon={copied ? CheckmarkCircle02Icon : Copy01Icon}
            size={18}
            className={copied ? "text-up" : "text-text-muted"}
          />
        </span>
      </button>

      <span
        className="mt-2 h-4 text-xs text-up"
        role="status"
        aria-live="polite"
      >
        {copied ? "Address copied" : ""}
      </span>

      {/* Sending the wrong asset or the wrong chain loses the funds, and this
          address looks identical in every Solana wallet — so the warning is
          stated rather than assumed. */}
      <div className="mt-3 flex items-start gap-2.5 rounded-2xl bg-down-soft p-3.5">
        <HugeiconsIcon
          icon={Alert02Icon}
          size={16}
          className="mt-px shrink-0 text-down"
        />
        <p className="text-[12px] leading-snug text-text-muted">
          Send only <span className="font-semibold text-text">USDC</span> on the{" "}
          <span className="font-semibold text-text">Solana</span> network. Any
          other token or chain will be lost.
        </p>
      </div>
    </div>
  );
}
