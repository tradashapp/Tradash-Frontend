"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { config } from "@/lib/config";
import { api } from "@/lib/api";
import { suggestedUsername } from "@/lib/username";
import { twitterAvatarUrl } from "@/lib/twitter";
import { setProfileAvatar } from "@/hooks/useProfile";
import {
  loadAgent,
  saveAgent,
  type StoredAgent,
} from "@/lib/bulk/agentStore";
import {
  clearApproval,
  hasApprovalFor,
  saveApproval,
} from "@/lib/bulk/builderStore";
import { generateAgentKeypair, makeAgentSigner, type AgentSigner } from "@/lib/bulk/signing";
import { fetchAccount } from "@/lib/bulk/client";
import { setFeeArrangementOwner } from "@/lib/bulk/feeArrangement";
import { clearPendingReferral, pendingReferral } from "@/lib/referral";
import {
  fundAccount,
  authorizeAgentWallet,
  approveBuilderCode,
  isAgentAlreadyAuthorizedError,
  type MasterSignBytes,
} from "@/lib/bulk/onboarding";
import { useAppDispatch } from "@/store/hooks";
import {
  setAgentAuthorized,
  setBuilderApproved,
  setOrderError,
} from "@/store/slices/tradingSlice";
import { setWallet } from "@/store/slices/userSlice";
import { useToast } from "@/components/toast/ToastProvider";

// Orchestrates the agent-wallet lifecycle:
//  - resolves the connected master wallet (Privy)
//  - loads/generates the agent session key
//  - runs the two master-signed onboarding steps (agent auth + builder approve)
//  - exposes a ready AgentSigner for one-tap trades
export function useAgentWallet() {
  const dispatch = useAppDispatch();
  const { user, authenticated, ready } = usePrivy();
  const { signMessage } = useSignMessage();
  const { toast } = useToast();

  const [signer, setSigner] = useState<AgentSigner | null>(null);
  const [onboarding, setOnboarding] = useState(false);

  // Privy DID — the stable identity across ALL login methods. This is the
  // backend key, so email/google/wallet logins for one person stay one user.
  const privyId = user?.id ?? null;

  // The embedded Solana wallet Privy creates for every user — this is the Bulk
  // master account. Pick the Solana wallet specifically (not EVM / external).
  const solanaWallet = user?.linkedAccounts.find(
    (a): a is typeof a & { address: string; chainType?: string } =>
      a.type === "wallet" &&
      "chainType" in a &&
      (a as { chainType?: string }).chainType === "solana"
  );
  const masterAddress =
    solanaWallet?.address ?? user?.wallet?.address ?? null;

  // The auth method the user logged in with (first non-wallet linked account,
  // else 'wallet').
  const authMethod =
    user?.linkedAccounts.find((a) => a.type !== "wallet")?.type ??
    (user?.linkedAccounts.length ? "wallet" : null);

  // Wrap Privy's signMessage into the base58-signature contract the keychain
  // onboarding expects.
  const masterSign: MasterSignBytes = useCallback(
    async (message) => {
      const sig = await signMessage({ message });
      return bs58.encode(sig);
    },
    [signMessage]
  );

  // Toast on connect / disconnect transitions the user actually performed.
  //
  // Gated on Privy's `ready`, which is what separates "restoring an existing
  // session" from "just logged in". Privy reports `authenticated: false` while
  // it rehydrates, so watching `authenticated` alone saw false→true on EVERY
  // app open and greeted returning users with "Wallet connected" every time.
  // Seeding the ref on the first ready render means the restored session is the
  // baseline, and only a genuine login or logout after that is announced.
  const wasAuthed = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (wasAuthed.current === null) {
      wasAuthed.current = authenticated;
      return;
    }
    if (authenticated && !wasAuthed.current) {
      toast("Wallet connected", { type: "success" });
    } else if (!authenticated && wasAuthed.current) {
      toast("Wallet disconnected", { type: "info" });
    }
    wasAuthed.current = authenticated;
  }, [ready, authenticated, toast]);

  // Track the wallet in Redux + sync the backend user by Privy DID (carrying the
  // embedded wallet, auth method, and linked accounts so one person = one row).
  useEffect(() => {
    dispatch(setWallet(masterAddress));
    if (privyId) {
      // Retried on failure: this CREATES the backend user row, and without it
      // the user has no record to attach trades to — they'd trade normally and
      // never appear in history or on the leaderboard.
      // A code from a ?ref= link rides along; the backend applies it only to
      // a new account. Cleared once handed to the outbox, which retries the
      // sync (code included) until it lands.
      const referralCode = pendingReferral();
      void api
        .syncUser({
          privyId,
          walletAddress: masterAddress,
          authMethod,
          linkedAccounts: user?.linkedAccounts as
            | { type: string }[]
            | undefined,
          // Seeds an EMPTY handle only, so a leaderboard row shows a real name
          // from the first trade. The backend never lets this overwrite a
          // handle the user has since chosen for themselves.
          username: suggestedUsername(user),
          ...(referralCode ? { referralCode } : {}),
        })
        .then(() => {
          if (referralCode) clearPendingReferral();
        });
    }
  }, [privyId, masterAddress, authMethod, user?.linkedAccounts, dispatch]);

  // The builder fee this user's orders carry is decided by the backend (fee
  // codes); prefetch it at login so the first order doesn't wait on it.
  useEffect(() => {
    setFeeArrangementOwner(privyId);
  }, [privyId]);

  // Adopt the X profile picture as the user's avatar — on an X login as well as
  // a later link from the profile panel, which is why this sits here (running
  // once for the session) rather than in the panel that offers the link button.
  //
  // Only for users who have NO avatar yet: re-linking must never overwrite a
  // photo they uploaded themselves. The ref stops a failed import from retrying
  // on every render, and the backend re-hosts the image (X's CDN blocks the
  // browser from reading it).
  const adoptedAvatar = useRef<string | null>(null);
  useEffect(() => {
    const remote = twitterAvatarUrl(user);
    if (!privyId || !remote || adoptedAvatar.current === remote) return;
    adoptedAvatar.current = remote;
    void (async () => {
      try {
        const profile = await api.fetchProfile(privyId);
        if (profile.avatarUrl) return;
        setProfileAvatar(await api.importAvatar(privyId, remote));
      } catch {
        // A missing avatar is cosmetic — never block login on it.
      }
    })();
  }, [privyId, user]);

  // Rehydrate an existing agent signer — but ONLY if Bulk actually has it
  // authorized. A stored key that Bulk doesn't recognize (e.g. from a failed
  // earlier onboarding) would otherwise masquerade as "ready" and every order
  // would fail with "unauthorized signer". We verify against the live account.
  //
  // The builder-code approval is rehydrated here too, but from a LOCAL cache
  // rather than the account: Bulk exposes no readable builder-approval state
  // (verified against every /account query type — see builderStore.ts). Without
  // this, `builderApproved` reset to false on every reload while the agent row
  // showed approved, and the onboard button — gated on the agent signer alone —
  // disappeared, leaving no way to ever re-approve.
  // Expose a read-only diagnostic on `window` so the actual state of this
  // browser's key can be INSPECTED rather than inferred. Every fix for
  // `bad signature` before this one was a guess about which pair of values
  // disagreed; this prints the answer. See lib/bulk/diagnose.ts.
  useEffect(() => {
    if (!masterAddress) return;
    (window as unknown as Record<string, unknown>).__tradashDiagnose = async () => {
      const { diagnoseAgent } = await import("@/lib/bulk/diagnose");
      const d = await diagnoseAgent(masterAddress);
      console.log("%c" + d.verdict, "font-weight:bold");
      console.table({
        network: d.network,
        signatureDomain: d.signatureDomain,
        storageKey: d.storageKey,
        storedPubkeyLabel: d.storedPubkeyLabel ?? "(none)",
        derivedPubkey: d.derivedPubkey ?? "(none)",
        labelMatchesSecret: String(d.labelMatchesSecret),
        derivedIsAuthorized: String(d.derivedIsAuthorized),
        labelIsAuthorized: String(d.labelIsAuthorized),
        builderApprovalMatches: String(d.builderApprovalMatches),
      });
      return d;
    };
  }, [masterAddress]);

  useEffect(() => {
    let cancelled = false;
    if (!masterAddress) {
      setSigner(null);
      return;
    }
    // Optimistic: cleared automatically when an order proves it wrong.
    dispatch(
      setBuilderApproved(
        hasApprovalFor(
          masterAddress,
          config.builder.recipient,
          config.builder.feeBps
        )
      )
    );
    const stored = loadAgent(masterAddress);
    if (!stored) {
      setSigner(null);
      dispatch(setAgentAuthorized(false));
      return;
    }
    (async () => {
      const acct = await fetchAccount(masterAddress).catch(() => null);
      // Build the signer FIRST and authorize against the pubkey DERIVED FROM
      // THE SECRET — never against the stored `pubkey` field.
      //
      // Those two can disagree, and when they do the failure is invisible:
      // the check passes (the stored pubkey really is authorized) while every
      // signature is made by a different key, so Bulk answers `bad signature`
      // on every order while the UI keeps showing "authorized". The stored
      // pubkey is a LABEL; the secret is the only thing that actually signs.
      //
      // How they diverge: `saveAgent` writes the pair non-atomically across
      // re-onboards, and localStorage is shared by every build pointed at this
      // origin. An account accumulating many authorized agents (this one had
      // 12) is the visible symptom of repeated re-onboarding, and only the
      // secret from the LAST one is still in the browser.
      let agentSigner: Awaited<ReturnType<typeof makeAgentSigner>> | null = null;
      try {
        agentSigner = await makeAgentSigner(stored.secretBase58, masterAddress);
      } catch {
        agentSigner = null; // unreadable/corrupt secret — treat as no agent
      }
      if (cancelled) return;
      const authorized =
        agentSigner != null &&
        (acct?.authorizedAgentWallets?.includes(agentSigner.pubkey) ?? false);
      if (authorized && agentSigner) {
        setSigner(agentSigner);
        dispatch(setAgentAuthorized(true));
        // Heal a stale label so the mismatch can't outlive this session.
        if (stored.pubkey !== agentSigner.pubkey) {
          saveAgent(masterAddress, {
            pubkey: agentSigner.pubkey,
            secretBase58: stored.secretBase58,
          });
        }
      } else {
        // The key we HOLD isn't authorized here — whatever the stored label
        // says. Not usable: force re-onboard.
        if (agentSigner && stored.pubkey !== agentSigner.pubkey) {
          console.warn(
            "[agent] stored pubkey does not match the stored secret — " +
              `label ${stored.pubkey}, actual ${agentSigner.pubkey}. Re-onboarding.`
          );
        }
        setSigner(null);
        dispatch(setAgentAuthorized(false));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [masterAddress, dispatch]);

  /**
   * Forget the builder approval after Bulk rejects an order for it. Bulk is the
   * only authority here, so a rejection means our cache lied: drop it and flip
   * the UI back to un-approved, which re-reveals the setup button.
   */
  const invalidateBuilderApproval = useCallback(() => {
    if (masterAddress) clearApproval(masterAddress);
    dispatch(setBuilderApproved(false));
  }, [masterAddress, dispatch]);

  /** Full one-time onboarding: create agent, authorize it, approve builder code. */
  const onboard = useCallback(async () => {
    if (!masterAddress || onboarding) return;
    setOnboarding(true);
    const TID = "onboard";
    toast("Setting up one-tap trading…", { type: "loading", id: TID });
    try {
      // 0. Fund + create the Bulk account. A fresh Privy wallet has NO Bulk
      //    account until funded — on testnet the faucet both creates and funds
      //    it in one step.
      //
      //    MAINNET IS DIFFERENT and deliberately does nothing here: funding
      //    means moving the user's real USDC, which needs an amount they chose.
      //    That flow already exists as the Wallet → Trading transfer in the
      //    account sheet (useCollateral.deposit), so onboarding sets up the
      //    agent and builder code — everything that costs nothing — and leaves
      //    the deposit to the user. Calling fundAccount with no amount would
      //    just throw and strand onboarding before the agent was authorized.
      if (config.bulk.network !== "mainnet") {
        try {
          await fundAccount(masterAddress, masterSign, {
            network: config.bulk.network,
          });
        } catch (e) {
          // Usually "already funded" / 24h rate limit — non-fatal, but surface
          // it so a real faucet problem isn't invisible.
          console.warn("[onboard] faucet step skipped/failed:", e);
        }
      }

      // 1. Agent keypair — reuse a stored one ONLY if its secret really is the
      // secret for its pubkey. A blob whose two halves disagree is worse than
      // no key at all: authorizing its (stale) pubkey succeeds, so setup
      // reports success, and then every order fails `bad signature` because a
      // different key does the signing. Re-authorizing the same broken pair is
      // exactly how an account ends up with a dozen authorized agents and no
      // working one. Verify, and generate fresh when it doesn't hold.
      let stored = loadAgent(masterAddress);
      if (stored) {
        // Re-label from the SECRET rather than discarding the key when the
        // label is wrong. The secret is the only part that matters; a stale
        // `pubkey` field is a bookkeeping error, not a reason to burn a working
        // (possibly already-authorized) key and add another to the account.
        const derived = await makeAgentSigner(stored.secretBase58, masterAddress)
          .then((s) => s.pubkey)
          .catch(() => null);
        if (!derived) {
          stored = null; // secret unreadable — genuinely unusable
        } else if (derived !== stored.pubkey) {
          console.warn(
            `[onboard] stored agent label ${stored.pubkey} does not match its ` +
              `secret (${derived}); re-labelling.`
          );
          stored = { pubkey: derived, secretBase58: stored.secretBase58 };
          saveAgent(masterAddress, stored);
        }
      }

      // Is the key we hold ALREADY authorized on the account? If so there is
      // nothing to authorize, and asking again is not idempotent — Bulk
      // rejects a duplicate with "agent wallet already exists" and the whole
      // setup fails at step 2.
      //
      // This is the state anyone lands in after forcing `agentAuthorized` back
      // to false by hand (or clearing it to re-run setup): the flag is local,
      // the authorization is not. The key is still perfectly good, so skip the
      // authorize call rather than regenerating — a fresh key would work too,
      // but it would add yet another entry to an account that already carries
      // twelve, and each one stays authorized forever.
      const existing = await fetchAccount(masterAddress).catch(() => null);
      const alreadyAuthorized =
        stored != null &&
        (existing?.authorizedAgentWallets?.includes(stored.pubkey) ?? false);

      if (!stored) {
        const kp = await generateAgentKeypair();
        stored = { pubkey: kp.pubkey, secretBase58: kp.secretBase58 } satisfies StoredAgent;
        saveAgent(masterAddress, stored);
      }

      // 2. Authorize the agent on the master account (master-signed), unless
      //    the account already has this exact key.
      if (alreadyAuthorized) {
        // Nothing to sign — the local flag was simply out of step with the
        // account. Converge on the truth instead of asking the user for a
        // signature that can only be rejected.
        dispatch(setAgentAuthorized(true));
      } else {
        toast("Authorizing agent wallet…", { type: "loading", id: TID });
        try {
          await authorizeAgentWallet(masterAddress, stored.pubkey, masterSign);
        } catch (e) {
          // "agent wallet already exists" means the authorization we wanted is
          // in place — the account and our local flag had merely drifted (a
          // race with the check above, or a retry after a dropped response).
          // The goal state is reached, so treat it as success rather than
          // failing setup for succeeding twice.
          if (!isAgentAlreadyAuthorizedError(e)) throw e;
        }
        dispatch(setAgentAuthorized(true));
      }
      if (privyId) void api.recordOnboard(privyId, "agent");

      // 3. Approve our builder code (master-signed) — required for revenue.
      //    Every order carries the builder code, so if this step fails EVERY
      //    trade is rejected with "builder-code fee Nbps not approved". It gets
      //    its own try/catch because a failure here is a distinct, recoverable
      //    state from a failed agent auth — previously both surfaced as one
      //    generic "Setup failed" and the difference was invisible.
      const { recipient, feeBps } = config.builder;
      if (recipient && feeBps) {
        // Already approved ON THE ACCOUNT? Then this step is done, whatever the
        // local cache says — the same drift as the agent flag above, and asking
        // again risks the same duplicate rejection.
        //
        // `builderCodeApprovals` IS readable on `fullAccount` (verified live
        // 2026-09-21 on mainnet), despite the comment in builderStore.ts
        // claiming no readable approval state — so the account can answer this
        // directly rather than trusting localStorage.
        //
        // `maxFee >= feeBps` because Bulk approves a fee CAP, not an exact fee:
        // an approval at 5bps covers a 5bps order, but raising
        // NEXT_PUBLIC_BUILDER_FEE_BPS to 10 needs a fresh approval.
        const approvedOnAccount =
          existing?.builderCodeApprovals?.some(
            (a) => a.recipient === recipient && a.maxFee >= feeBps
          ) ?? false;

        if (!approvedOnAccount) {
          toast("Approving builder code…", { type: "loading", id: TID });
          try {
            await approveBuilderCode(masterAddress, recipient, feeBps, masterSign);
          } catch (e) {
            // Don't let a bad cache outlive the failure.
            clearApproval(masterAddress);
            dispatch(setBuilderApproved(false));
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(
              `Builder-code approval failed: ${msg.replace(/^Bulk order error:\s*/, "")}`
            );
          }
        }

        saveApproval(masterAddress, { recipient, feeBps });
        dispatch(setBuilderApproved(true));
        if (privyId) void api.recordOnboard(privyId, "builder");
      }

      // 4. Ready signer — but CONFIRM against the account before claiming
      //    success. Setup previously announced "one-tap trading enabled" on the
      //    strength of the calls not throwing, which is how a browser ended up
      //    holding a key the account does not accept while the UI insisted
      //    everything was fine. Re-read and check the key we will actually sign
      //    with; if it isn't there, say so here rather than at the first trade.
      const readySigner = await makeAgentSigner(stored.secretBase58, masterAddress);
      const confirmed = await fetchAccount(masterAddress).catch(() => null);
      const signerIsLive =
        confirmed?.authorizedAgentWallets?.includes(readySigner.pubkey) ?? false;

      setSigner(readySigner);
      if (!signerIsLive) {
        // Don't strand the user on a false success. The account read can also
        // simply be stale, so this is a warning, not a thrown error.
        dispatch(setAgentAuthorized(false));
        console.warn(
          `[onboard] agent ${readySigner.pubkey} is not in ` +
            `authorizedAgentWallets after setup: ` +
            `${JSON.stringify(confirmed?.authorizedAgentWallets ?? [])}`
        );
        toast("Setup incomplete", {
          type: "error",
          id: TID,
          description:
            "Your trading key wasn't registered. Tap setup again — run " +
            "__tradashDiagnose() in the console if it repeats.",
        });
        return;
      }
      toast("One-tap trading enabled", {
        type: "success",
        id: TID,
        description: "Your account is funded and ready to trade.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Onboarding failed";
      dispatch(setOrderError(msg));
      toast("Setup failed", {
        type: "error",
        id: TID,
        description: msg.replace(
          /^(Bulk order error|Agent wallet authorization failed):\s*/,
          ""
        ),
      });
    } finally {
      setOnboarding(false);
    }
  }, [privyId, masterAddress, onboarding, masterSign, dispatch, toast]);

  /**
   * Run ONLY the builder-code approval (master-signed).
   *
   * Needed on its own because the agent wallet and the builder code fail
   * independently: an account can have a working agent signer while the `abc`
   * approval never landed, and re-running full onboarding to fix that would
   * pointlessly re-prompt for the agent signature.
   */
  const approveBuilder = useCallback(async () => {
    const { recipient, feeBps } = config.builder;
    if (!masterAddress || onboarding || !recipient || !feeBps) return;
    setOnboarding(true);
    const TID = "approve-builder";
    toast("Approving builder code…", { type: "loading", id: TID });
    try {
      await approveBuilderCode(masterAddress, recipient, feeBps, masterSign);
      saveApproval(masterAddress, { recipient, feeBps });
      dispatch(setBuilderApproved(true));
      if (privyId) void api.recordOnboard(privyId, "builder");
      toast("Builder code approved", {
        type: "success",
        id: TID,
        description: "You're ready to trade.",
      });
    } catch (e) {
      clearApproval(masterAddress);
      dispatch(setBuilderApproved(false));
      const msg = e instanceof Error ? e.message : "Approval failed";
      dispatch(setOrderError(msg));
      toast("Approval failed", {
        type: "error",
        id: TID,
        description: msg.replace(/^Bulk order error:\s*/, ""),
      });
    } finally {
      setOnboarding(false);
    }
  }, [privyId, masterAddress, onboarding, masterSign, dispatch, toast]);

  return {
    privyId,
    masterAddress,
    authMethod,
    authenticated,
    signer,
    isReady: signer !== null,
    onboarding,
    onboard,
    // Builder-code approval, separate from the agent wallet: they fail
    // independently and each needs its own recovery path.
    approveBuilder,
    invalidateBuilderApproval,
    // Master (Privy) byte-signer — needed for collateral deposits/withdrawals,
    // which are master-signed transfers (the agent key can't sign these).
    masterSign,
  };
}
