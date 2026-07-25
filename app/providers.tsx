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
      <ReduxProvider store={storeRef.current}>{children}</ReduxProvider>
    </PrivyProvider>
  );
}
