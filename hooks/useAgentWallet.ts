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
import {
  fundAccount,
  authorizeAgentWallet,
  approveBuilderCode,
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
        });
    }
  }, [privyId, masterAddress, authMethod, user?.linkedAccounts, dispatch]);

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
      const authorized =
        acct?.authorizedAgentWallets?.includes(stored.pubkey) ?? false;
      if (cancelled) return;
      if (authorized) {
        setSigner(await makeAgentSigner(stored.secretBase58, masterAddress));
        dispatch(setAgentAuthorized(true));
      } else {
        // Stored key isn't authorized on-chain — not usable. Force re-onboard.
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

      // 1. Agent keypair (reuse if present).
      let stored = loadAgent(masterAddress);
      if (!stored) {
        const kp = await generateAgentKeypair();
        stored = { pubkey: kp.pubkey, secretBase58: kp.secretBase58 } satisfies StoredAgent;
        saveAgent(masterAddress, stored);
      }

      // 2. Authorize the agent on the master account (master-signed).
      toast("Authorizing agent wallet…", { type: "loading", id: TID });
      await authorizeAgentWallet(masterAddress, stored.pubkey, masterSign);
      dispatch(setAgentAuthorized(true));
      if (privyId) void api.recordOnboard(privyId, "agent");

      // 3. Approve our builder code (master-signed) — required for revenue.
      //    Every order carries the builder code, so if this step fails EVERY
      //    trade is rejected with "builder-code fee Nbps not approved". It gets
      //    its own try/catch because a failure here is a distinct, recoverable
      //    state from a failed agent auth — previously both surfaced as one
      //    generic "Setup failed" and the difference was invisible.
      const { recipient, feeBps } = config.builder;
      if (recipient && feeBps) {
        toast("Approving builder code…", { type: "loading", id: TID });
        try {
          await approveBuilderCode(masterAddress, recipient, feeBps, masterSign);
          saveApproval(masterAddress, { recipient, feeBps });
          dispatch(setBuilderApproved(true));
          if (privyId) void api.recordOnboard(privyId, "builder");
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

      // 4. Ready signer.
      setSigner(await makeAgentSigner(stored.secretBase58, masterAddress));
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
