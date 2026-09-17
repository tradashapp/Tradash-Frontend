"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Provider as ReduxProvider } from "react-redux";
import { PrivyProvider } from "@privy-io/react-auth";
import { makeStore, type AppStore } from "@/store";
import { wireSettingsPersistence } from "@/store/persist";
import { ToastProvider } from "@/components/toast/ToastProvider";
import { config } from "@/lib/config";
import { startOutbox } from "@/lib/outbox";
import { AuthTokenBridge } from "@/components/auth/AuthTokenBridge";

// Single client-side provider tree: Redux (with settings persistence wired
// once) + Toasts, wrapped by Privy for wallet connect / master-account auth.
export function Providers({ children }: { children: ReactNode }) {
  const storeRef = useRef<AppStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = makeStore();
  }

  // Persisted state is read in an EFFECT, not during render.
  //
  // Reading localStorage while building the store put the user's stored values
  // (position size, leverage, mode) into the very first client render, while
  // the server had rendered the defaults — so every component showing one
  // hydration-mismatched ("$916.87" vs "$100.00" in the market dock). Loading
  // after mount means the first client paint matches the server HTML exactly
  // and the stored values arrive one commit later, as a normal state update.
  //
  // The ref guard keeps this to one run: in StrictMode dev the effect fires
  // twice, and re-running would re-dispatch the whole hydration.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !storeRef.current) return;
    hydratedRef.current = true;
    wireSettingsPersistence(storeRef.current);
  }, []);

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
          // Relative, not an absolute https://tradash.xyz URL. The file is our
          // own `/public` asset, so pointing at the canonical domain made the
          // browser fetch it cross-origin — blocked by `img-src 'self'` on
          // every other origin (localhost, preview deploys, app.tradash.xyz).
          // A relative path resolves against whatever host is serving the page.
          logo: "/images/logos/tradash-full.png",
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
      {/* Inside PrivyProvider: gives lib/api.ts a live access-token source so
          backend requests are authenticated. Renders nothing. */}
      <AuthTokenBridge />
      {tree}
    </PrivyProvider>
  );
}
