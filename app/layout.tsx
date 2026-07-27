import type { Metadata, Viewport } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { RegisterSW } from "@/components/pwa/RegisterSW";

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
  title: "Tradash",
  description: "Tap to trade. Perpetuals, made instant.",
  manifest: "/manifest.webmanifest",
  applicationName: "Tradash",
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
        <Providers>{children}</Providers>
        <RegisterSW />
      </body>
    </html>
  );
}
