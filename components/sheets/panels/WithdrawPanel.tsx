"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Loading03Icon,
  Alert02Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  BookmarkAdd02Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import { formatUsd } from "@/lib/format";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { RecipientLookup } from "@/lib/api";
import type { useWithdrawal } from "@/hooks/useWithdrawal";

/**
 * Send USDC from the user's wallet to an outside Solana address.
 *
 * Separate from the Transfer panel, which shuffles funds between the user's own
 * two balances. Money leaving the app entirely deserves its own screen: a
 * recipient to validate, an address book, and a confirmation step for an
 * address we have never sent to before.
 *
 * The network fee is paid by the app's sponsor, so the user needs no SOL.
 */

/** Middle-truncate an address: 7 leading, 6 trailing. */
const short = (a: string) => `${a.slice(0, 7)}…${a.slice(-6)}`;

export function WithdrawPanel({
  withdrawal,
  walletUsdc,
}: {
  withdrawal: ReturnType<typeof useWithdrawal>;
  /** The user's spendable wallet USDC, or null while unknown. */
  walletUsdc: number | null;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [lookup, setLookup] = useState<RecipientLookup | null>(null);
  // After a successful send: offer to save the address under a name.
  const [savePrompt, setSavePrompt] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  // A first-time address requires an explicit acknowledgement before sending.
  const [acknowledged, setAcknowledged] = useState(false);
  // The address book is collapsed by default — see the toggle below.
  const [bookOpen, setBookOpen] = useState(false);

  const amt = Number(amount) || 0;
  const trimmed = recipient.trim();

  // Validate the recipient, debounced. Each check is an RPC round trip, so it
  // must not fire per keystroke; the guard also drops responses that arrive
  // after the input changed again.
  //
  // The effect depends on the ADDRESS ALONE. `inspect` is reached through a ref
  // so that nothing else about the hook can retrigger it: this effect's cleanup
  // cancels the pending timer, so any unrelated re-render that re-ran it would
  // push the lookup back another 450ms. With `withdrawal` itself in the deps,
  // the hook's own `checking` flag and the 30s wallet poll in the sibling
  // collateral hook did exactly that, starving the request indefinitely.
  const inspectRef = useRef(withdrawal.inspect);
  inspectRef.current = withdrawal.inspect;

  const latest = useRef(0);
  useEffect(() => {
    if (!trimmed) {
      setLookup(null);
      return;
    }
    // Bumped here so a response that arrives after the input changed again is
    // discarded rather than overwriting the answer for what is now on screen.
    const seq = ++latest.current;
    const t = setTimeout(async () => {
      const result = await inspectRef.current(trimmed);
      if (seq === latest.current) {
        setLookup(result);
        setAcknowledged(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [trimmed]);

  const saved = withdrawal.addresses;
  const overBalance = walletUsdc != null && amt > walletUsdc;
  // The verified recipient, or null when the lookup is pending or failed.
  const check = lookup?.status === "ok" ? lookup.check : null;

  /**
   * Every condition that must hold before money can leave.
   *
   * This must account for EVERY state in which the send is refused, including
   * the ones where we simply have no answer yet. A gap here is invisible: the
   * button renders its idle label while staying disabled, which reads as the
   * app being broken rather than as a step still outstanding.
   */
  const blocker = useMemo(() => {
    if (!trimmed) return "Enter a recipient address";
    if (withdrawal.checking) return "Checking address…";
    if (!lookup) return "Checking address…";
    if (lookup.status === "error") return lookup.message;
    if (!lookup.check.valid) return lookup.check.reason ?? "Invalid address";
    if (!lookup.check.hasUsdcAccount)
      return "Recipient needs a USDC account first";
    if (amt <= 0) return "Enter an amount";
    if (overBalance) return "Exceeds wallet balance";
    if (lookup.check.firstTime && !acknowledged)
      return "Confirm the address first";
    return null;
  }, [trimmed, lookup, withdrawal.checking, amt, overBalance, acknowledged]);

  // `blocker` now covers the unverified cases on its own, so no extra term is
  // needed here — one that `blocker` did not also cover is exactly what
  // produced a disabled button labelled "Send USDC".
  const canSubmit = !blocker && !withdrawal.busy;

  const submit = async () => {
    if (!canSubmit) return;
    playSound("tap");
    haptic("tap");
    const signature = await withdrawal.withdraw(trimmed, amt);
    if (signature) {
      // Only offer to save an address that is not already in the book.
      if (check?.firstTime) setSavePrompt(trimmed);
      setAmount("");
      setRecipient("");
      setLookup(null);
      setAcknowledged(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Address book — collapsed to a single row. The full list pushed the
          amount field off screen on a phone, so it expands only on request. */}
      {saved.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => {
              playSound("tap");
              haptic("tap");
              setBookOpen((v) => !v);
            }}
            aria-expanded={bookOpen}
            className="glass-inset flex items-center justify-between rounded-2xl px-4 py-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-text">
              <HugeiconsIcon icon={BookmarkAdd02Icon} size={15} />
              Address book
              <span className="text-[11px] font-normal text-text-muted">
                {saved.length}
              </span>
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={16}
              className={`text-text-muted transition-transform ${
                bookOpen ? "rotate-180" : ""
              }`}
            />
          </button>

          {bookOpen && (
            <div className="flex flex-col gap-1.5">
              {saved.map((a) => (
                <div
                  key={a.id}
                  className="glass-inset flex items-center justify-between rounded-2xl px-4 py-3"
                >
                  <button
                    type="button"
                    onClick={() => {
                      playSound("tap");
                      haptic("tap");
                      setRecipient(a.address);
                      // Picking one is the point of opening the list, so close
                      // it again and leave the amount field in view.
                      setBookOpen(false);
                    }}
                    className="flex min-w-0 flex-1 flex-col items-start text-left"
                  >
                    <span className="truncate text-sm font-semibold text-text">
                      {a.label}
                    </span>
                    <span className="tabular truncate text-[11px] text-text-muted">
                      {short(a.address)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      haptic("tap");
                      void withdrawal.deleteAddress(a.id);
                    }}
                    aria-label={`Remove ${a.label}`}
                    className="ml-2 shrink-0 rounded-lg p-2 text-text-muted transition-colors hover:text-down"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recipient */}
      <div className="glass-inset rounded-2xl p-4">
        <div className="mb-1 text-xs text-text-muted">Recipient address</div>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="Solana address"
          className="w-full bg-transparent font-mono text-sm text-text outline-none placeholder:text-text-muted/50"
        />
        <RecipientStatus checking={withdrawal.checking} lookup={lookup} />
      </div>

      {/* Amount */}
      <div className="glass-inset rounded-2xl p-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-text-muted">Amount (USDC)</span>
          <span className="tabular text-[11px] text-text-muted">
            Wallet: {walletUsdc != null ? formatUsd(walletUsdc) : "—"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-text-muted">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tabular w-full bg-transparent text-2xl font-semibold text-text outline-none"
            placeholder="0"
          />
          {walletUsdc != null && walletUsdc > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(walletUsdc))}
              className="rounded-lg bg-white/5 px-2 py-1 text-[11px] font-semibold text-text-muted transition-colors hover:text-text"
            >
              MAX
            </button>
          )}
        </div>
        {overBalance && (
          <div className="mt-1 text-[10px] text-down">
            Exceeds wallet balance
          </div>
        )}
      </div>

      {/* First-time address: an explicit confirmation, because a wrong address
          means the funds are gone and nothing on-chain can undo it. */}
      {check?.valid && check.hasUsdcAccount && check.firstTime && (
        <button
          type="button"
          onClick={() => {
            haptic("tap");
            setAcknowledged((v) => !v);
          }}
          className="glass-inset flex items-start gap-3 rounded-2xl p-4 text-left"
        >
          <span
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
              acknowledged
                ? "border-up bg-up text-black"
                : "border-white/25 text-transparent"
            }`}
          >
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
          </span>
          <span className="text-[11px] leading-relaxed text-text-muted">
            First time sending to this address. I have checked that{" "}
            <span className="tabular font-semibold text-text">
              {short(trimmed)}
            </span>{" "}
            is correct — transfers cannot be reversed.
          </span>
        </button>
      )}

      {/* Send */}
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-up py-3.5 font-semibold text-black transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {withdrawal.busy && (
          <HugeiconsIcon icon={Loading03Icon} size={18} className="animate-spin" />
        )}
        {withdrawal.busy ? "Sending…" : (blocker ?? "Send USDC")}
      </button>

      {/* Post-send: save this address to the book under a name. Raised as its
          own modal rather than appended below the form — inline, it landed
          under the fold right after the panel reset, so it was easy to miss. */}
      <SaveAddressModal
        address={savePrompt}
        label={label}
        onLabelChange={setLabel}
        onDismiss={() => {
          setSavePrompt(null);
          setLabel("");
        }}
        onSave={async () => {
          if (!savePrompt) return;
          playSound("tap");
          haptic("tap");
          await withdrawal.saveAddress(savePrompt, label.trim());
          setSavePrompt(null);
          setLabel("");
        }}
      />
    </div>
  );
}

/**
 * "Save this address?" after a successful send.
 *
 * Sits at z-[71], matching ConfirmModal: it is raised BY the account sheet
 * (z-50) and must sit above its own opener.
 */
function SaveAddressModal({
  address,
  label,
  onLabelChange,
  onDismiss,
  onSave,
}: {
  /** The address to save, or null when the modal is closed. */
  address: string | null;
  label: string;
  onLabelChange: (v: string) => void;
  onDismiss: () => void;
  onSave: () => void;
}) {
  // Escape dismisses, matching a scrim tap — never the action.
  useEffect(() => {
    if (!address) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [address, onDismiss]);

  return (
    <AnimatePresence>
      {address && (
        <>
          <motion.div
            className="fixed inset-0 z-[70] bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onDismiss}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Save this address"
            className="fixed inset-x-6 top-1/2 z-[71] mx-auto flex max-w-xs -translate-y-1/2 flex-col rounded-3xl bg-bg-elevated p-5 ring-1 ring-white/10"
            initial={{ opacity: 0, scale: 0.94, y: "-46%" }}
            animate={{ opacity: 1, scale: 1, y: "-50%" }}
            exit={{ opacity: 0, scale: 0.94, y: "-46%" }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2 className="flex items-center justify-center gap-2 text-center text-base font-semibold">
              <HugeiconsIcon icon={BookmarkAdd02Icon} size={16} />
              Save this address?
            </h2>
            <p className="tabular mt-2 text-center text-[11px] text-text-muted">
              {short(address)}
            </p>
            <input
              type="text"
              value={label}
              onChange={(e) => onLabelChange(e.target.value)}
              maxLength={40}
              autoFocus
              placeholder="Name (e.g. Coinbase)"
              className="mt-4 w-full rounded-xl bg-white/5 px-3 py-2.5 text-sm text-text outline-none placeholder:text-text-muted/50"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={onDismiss}
                className="glass-inset flex-1 rounded-2xl py-3 text-sm font-medium text-text-muted transition-colors hover:text-text active:scale-95"
              >
                Not now
              </button>
              <button
                type="button"
                disabled={!label.trim()}
                onClick={onSave}
                className="flex-1 rounded-2xl bg-up py-3 text-sm font-bold text-black transition-transform active:scale-95 disabled:opacity-45"
              >
                Save
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Inline verdict under the recipient field. */
function RecipientStatus({
  checking,
  lookup,
}: {
  checking: boolean;
  lookup: RecipientLookup | null;
}) {
  if (checking) {
    return (
      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-text-muted">
        <HugeiconsIcon icon={Loading03Icon} size={11} className="animate-spin" />
        Checking address…
      </div>
    );
  }
  if (!lookup) return null;

  // A lookup that never completed. Rendering nothing here is what made the
  // disabled send button look unexplained, so it gets a line of its own.
  if (lookup.status === "error") {
    return (
      <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-down">
        <HugeiconsIcon icon={Alert02Icon} size={11} className="mt-px shrink-0" />
        <span>{lookup.message}</span>
      </div>
    );
  }

  const check = lookup.check;

  // Invalid, or valid-but-unusable (no USDC account). Both block the send.
  if (!check.valid || !check.hasUsdcAccount) {
    return (
      <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-down">
        <HugeiconsIcon icon={Alert02Icon} size={11} className="mt-px shrink-0" />
        <span>{check.reason ?? "This address cannot receive USDC."}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-1.5 text-[10px] text-up">
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={11} />
      <span>
        Valid
        {check.usdcBalance != null &&
          ` · holds ${formatUsd(check.usdcBalance)}`}
        {check.firstTime && " · first time sending here"}
      </span>
    </div>
  );
}
