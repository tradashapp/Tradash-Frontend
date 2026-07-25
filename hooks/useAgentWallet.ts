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

  // The connected Solana master account address.
  const masterAddress =
    user?.wallet?.address ??
    user?.linkedAccounts.find((a) => a.type === "wallet")?.address ??
    null;

  // Wrap Privy's signMessage into the base58-signature contract the keychain
  // onboarding expects.
  const masterSign: MasterSignBytes = useCallback(
    async (message) => {
      const sig = await signMessage({ message });
      return bs58.encode(sig);
    },
    [signMessage]
  );

  // Track the wallet in Redux + ensure the backend user exists.
  useEffect(() => {
    dispatch(setWallet(masterAddress));
    if (masterAddress) api.ensureUser(masterAddress).catch(() => {});
  }, [masterAddress, dispatch]);

  // Rehydrate an existing agent signer for this wallet.
  useEffect(() => {
    let cancelled = false;
    if (!masterAddress) {
      setSigner(null);
      return;
    }
    const stored = loadAgent(masterAddress);
    if (stored) {
      makeAgentSigner(stored.secretBase58).then((s) => {
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
      api.recordOnboard(masterAddress, "agent").catch(() => {});

      // 3. Approve our builder code (master-signed) — required for revenue.
      if (config.builder.recipient && config.builder.feeBps) {
        await approveBuilderCode(
          masterAddress,
          config.builder.recipient,
          config.builder.feeBps,
          masterSign
        );
        dispatch(setBuilderApproved(true));
        api.recordOnboard(masterAddress, "builder").catch(() => {});
      }

      // 4. Ready signer.
      setSigner(await makeAgentSigner(stored.secretBase58));
    } catch (e) {
      dispatch(setOrderError(e instanceof Error ? e.message : "Onboarding failed"));
    } finally {
      setOnboarding(false);
    }
  }, [masterAddress, onboarding, masterSign, dispatch]);

  return {
    masterAddress,
    authenticated,
    signer,
    isReady: signer !== null,
    onboarding,
    onboard,
  };
}
