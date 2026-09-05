"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { PrivyProvider } from "@privy-io/react-auth";
import { makeStore, type AppStore } from "@/store";
import { wireSettingsPersistence } from "@/store/persist";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { config } from "@/lib/config";
import { startOutbox } from "@/lib/outbox";

// Single client-side provider tree: Redux (with settings persistence wired
// once) + Toasts, wrapped by Privy for wallet connect / master-account auth.
export function Providers({ children }: { children: ReactNode }) {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeStore();
    wireSettingsPersistence(storeRef.current);
  }

  // Drain any writes queued while the API was unreachable — including ones from
  // a PREVIOUS session, since the queue is persisted. Runs once per mount, and
  // then again on `online` / tab-focus (wired inside startOutbox).
  useEffect(() => {
    startOutbox();
  }, []);

  const tree = (
    <ReduxProvider store={storeRef.current}>
      <ToastProvider>{children}</ToastProvider>
    </ReduxProvider>
  );

  // Privy throws if constructed without an appId. Until NEXT_PUBLIC_PRIVY_APP_ID
  // is set (e.g. during the Phase 1 visual work), run without wallet auth so the
  // chart/UI still boots. Wallet connect activates automatically once it's set.
  if (!config.privyAppId) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[providers] NEXT_PUBLIC_PRIVY_APP_ID not set — running without Privy (no wallet connect)."
      );
    }
    return tree;
  }

  return (
    <PrivyProvider
      appId={config.privyAppId}
      config={{
        appearance: {
          theme: "#08090C",
          accentColor: "#72E912",
          logo: "https://tradash.xyz/images/logos/tradash-full.png",

        },
        embeddedWallets: {
          solana: {
            createOnLogin: "all-users",
          },
          requireUserPasswordOnCreate: false,
        },
        loginMethods: ["email", "google", "twitter", "wallet"],
      }}
    >
      {tree}
    </PrivyProvider>
  );
}
