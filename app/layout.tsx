import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { SplashScreen } from "@/components/splash/SplashScreen";
import { config } from "@/lib/config";

// Space Grotesk is the main UI typeface; JetBrains Mono backs tabular figures.
const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  // Resolves relative OG/Twitter image URLs to absolute for crawlers. Set
  // NEXT_PUBLIC_APP_URL to the production origin.
  metadataBase: new URL(config.appUrl),
  title: {
    default: "Tradash — Tap to trade perpetuals",
    // Per-market pages pass a full title, so no template suffix is needed.
    template: "%s",
  },
  description: "Tap to trade. Perpetuals, made instant.",
  manifest: "/manifest.webmanifest",
  applicationName: "Tradash",
  openGraph: {
    title: "Tradash — Tap to trade perpetuals",
    description: "Tap to trade. Perpetuals, made instant.",
    siteName: "Tradash",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tradash — Tap to trade perpetuals",
    description: "Tap to trade. Perpetuals, made instant.",
  },
  appleWebApp: {
    capable: true,
    title: "Tradash",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#08090c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // Mobile-first: prevent zoom so tap-to-trade never mis-fires on double tap.
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`}>
      <body>
        <SplashScreen />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
