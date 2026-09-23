import type { Metadata } from "next";

// /og-preview is an internal design tool, not a product surface. The page
// itself is a client component and so cannot export metadata; this layout
// carries the noindex. Without it the route would inherit the root card and
// could surface in search or in a shared link.
export const metadata: Metadata = {
  title: "OG preview",
  robots: { index: false, follow: false },
};

export default function OgPreviewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
