import { LandingGate } from "@/components/landing/LandingGate";

// The marketing landing page. The trading app lives at /trade (and
// /trade/<MARKET>); logged-in visitors and installed-PWA launches are redirected
// there by LandingGate.
export default function Home() {
  return <LandingGate />;
}
