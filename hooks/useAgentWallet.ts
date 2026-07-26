"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useSignMessage } from "@privy-io/react-auth/solana";
import bs58 from "bs58";
import { config } from "@/lib/config";
import { api } from "@/lib/api";
import {
  loadAgent,
  saveAgent,
  type StoredAgent,
} from "@/lib/bulk/agentStore";
import { generateAgentKeypair, makeAgentSigner, type AgentSigner } from "@/lib/bulk/signing";
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

// Orchestrates the agent-wallet lifecycle:
//  - resolves the connected master wallet (Privy)
//  - loads/generates the agent session key
//  - runs the two master-signed onboarding steps (agent auth + builder approve)
//  - exposes a ready AgentSigner for one-tap trades
export function useAgentWallet() {
  const dispatch = useAppDispatch();
  const { user, authenticated } = usePrivy();
  const { signMessage } = useSignMessage();

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

  // Track the wallet in Redux + sync the backend user by Privy DID (carrying the
  // embedded wallet, auth method, and linked accounts so one person = one row).
  useEffect(() => {
    dispatch(setWallet(masterAddress));
    if (privyId) {
      api
        .syncUser({
          privyId,
          walletAddress: masterAddress,
          authMethod,
          linkedAccounts: user?.linkedAccounts as
            | { type: string }[]
            | undefined,
        })
        .catch(() => {});
    }
  }, [privyId, masterAddress, authMethod, user?.linkedAccounts, dispatch]);

  // Rehydrate an existing agent signer for this wallet.
  useEffect(() => {
    let cancelled = false;
    if (!masterAddress) {
      setSigner(null);
      return;
    }
    const stored = loadAgent(masterAddress);
    if (stored) {
      makeAgentSigner(stored.secretBase58, masterAddress).then((s) => {
        if (!cancelled) {
          setSigner(s);
          dispatch(setAgentAuthorized(true));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [masterAddress, dispatch]);

  /** Full one-time onboarding: create agent, authorize it, approve builder code. */
  const onboard = useCallback(async () => {
    if (!masterAddress || onboarding) return;
    setOnboarding(true);
    try {
      // 0. Fund + create the Bulk account. A fresh Privy wallet has NO Bulk
      //    account until funded — this creates it. On testnet that's the faucet;
      //    on mainnet it's a real USDC deposit (config.bulk.network switches it).
      //    Tolerate failure on testnet (already funded / 24h rate limit); on
      //    mainnet a failed deposit should surface, so only swallow on testnet.
      try {
        await fundAccount(masterAddress, masterSign, {
          network: config.bulk.network,
          // TODO(mainnet): collect the deposit amount from the user first.
          depositAmount: undefined,
        });
      } catch (e) {
        if (config.bulk.network === "mainnet") throw e;
        // testnet: usually "already funded" / 24h rate limit — non-fatal, but
        // surface it so a real faucet problem isn't invisible.
        console.warn("[onboard] faucet step skipped/failed:", e);
      }

      // 1. Agent keypair (reuse if present).
      let stored = loadAgent(masterAddress);
      if (!stored) {
        const kp = await generateAgentKeypair();
        stored = { pubkey: kp.pubkey, secretBase58: kp.secretBase58 } satisfies StoredAgent;
        saveAgent(masterAddress, stored);
      }

      // 2. Authorize the agent on the master account (master-signed).
      await authorizeAgentWallet(masterAddress, stored.pubkey, masterSign);
      dispatch(setAgentAuthorized(true));
      if (privyId) api.recordOnboard(privyId, "agent").catch(() => {});

      // 3. Approve our builder code (master-signed) — required for revenue.
      if (config.builder.recipient && config.builder.feeBps) {
        await approveBuilderCode(
          masterAddress,
          config.builder.recipient,
          config.builder.feeBps,
          masterSign
        );
        dispatch(setBuilderApproved(true));
        if (privyId) api.recordOnboard(privyId, "builder").catch(() => {});
      }

      // 4. Ready signer.
      setSigner(await makeAgentSigner(stored.secretBase58, masterAddress));
    } catch (e) {
      dispatch(setOrderError(e instanceof Error ? e.message : "Onboarding failed"));
    } finally {
      setOnboarding(false);
    }
  }, [privyId, masterAddress, onboarding, masterSign, dispatch]);

  return {
    privyId,
    masterAddress,
    authMethod,
    authenticated,
    signer,
    isReady: signer !== null,
    onboarding,
    onboard,
  };
}
