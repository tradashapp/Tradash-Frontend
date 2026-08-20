"use client";

import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { config } from "@/lib/config";
import { LandingHero } from "./LandingHero";

// Decides whether a visitor sees the marketing hero or goes straight to the app.
//
// Two cases skip the landing page entirely:
//   1. Already logged in — they've onboarded; the hero is just a speed bump.
//   2. Launched as an installed PWA — the manifest's start_url is "/", so the
//      installed app would otherwise open on marketing copy instead of the
//      chart.
//
// Until that decision is made we render nothing rather than the hero: showing
// the landing page for a frame and then yanking it away is worse than a brief
// blank, especially from the app icon.
export function LandingGate() {
  // Privy's hooks throw outside a PrivyProvider, and the provider is skipped
  // when no appId is configured (see providers.tsx). Branching on a build-time
  // constant at the COMPONENT level (rather than around a hook call) keeps the
  // rules of hooks intact: each variant calls a fixed set of hooks.
  return config.privyAppId ? <GateWithAuth /> : <GateWithoutAuth />;
}

function GateWithAuth() {
  const { ready, authenticated } = usePrivy();
  return <Gate ready={ready} authenticated={authenticated} />;
}

function GateWithoutAuth() {
  // No wallet auth configured — nobody is logged in, so only the PWA check
  // can redirect.
  return <Gate ready authenticated={false} />;
}

function Gate({
  ready,
  authenticated,
}: {
  ready: boolean;
  authenticated: boolean;
}) {
  const router = useRouter();
  const [decided, setDecided] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  // PWA check is synchronous and independent of auth — do it first.
  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setRedirecting(true);
      router.replace("/trade");
    }
  }, [router]);

  useEffect(() => {
    if (redirecting) return;
    // `ready` false means Privy hasn't restored the session yet — waiting
    // avoids flashing the hero at a logged-in user.
    if (!ready) return;
    if (authenticated) {
      setRedirecting(true);
      router.replace("/trade");
      return;
    }
    setDecided(true);
  }, [ready, authenticated, redirecting, router]);

  if (redirecting || !decided) {
    return <div className="h-dvh w-full bg-bg" />;
  }
  return <LandingHero />;
}
