import fs from "fs";
import path from "path";

// Default OG/Twitter image for the root (/) and every route without its own
// card, which includes /trade. Per-market routes (/trade/BTC, …) keep their
// generated cards. Serves the static brand banner (pre-cropped to 1200×630)
// rather than a static opengraph-image.jpg, so the URL stays /opengraph-image
// for the og-preview page.
export const runtime = "nodejs";
export const alt = "Tradash — One Tap Away From Glory";
export const size = { width: 1200, height: 630 };
export const contentType = "image/jpeg";

export default function Image() {
  const file = fs.readFileSync(path.join(process.cwd(), "public", "images/og/tradash-og.jpg"));
  return new Response(new Uint8Array(file), {
    headers: { "Content-Type": contentType },
  });
}
