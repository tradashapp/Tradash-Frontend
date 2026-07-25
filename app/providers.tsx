"use client";

import { useRef, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { PrivyProvider } from "@privy-io/react-auth";
import { makeStore, type AppStore } from "@/store";
import { wireSettingsPersistence } from "@/store/persist";
import { config } from "@/lib/config";

// Single client-side provider tree: Redux (with settings persistence wired
// once) wrapped by Privy for wallet connect / master-account auth.
export function Providers({ children }: { children: ReactNode }) {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeStore();
    wireSettingsPersistence(storeRef.current);
  }

  const tree = (
    <ReduxProvider store={storeRef.current}>{children}</ReduxProvider>
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
        appearance: { theme: "dark", accentColor: "#16c784" },
        // Solana-only app; embedded wallet created for users without one so we
        // can authorize a Bulk agent wallet against it.
        embeddedWallets: { createOnLogin: "users-without-wallets" },
      }}
    >
      {tree}
    </PrivyProvider>
  );
}
