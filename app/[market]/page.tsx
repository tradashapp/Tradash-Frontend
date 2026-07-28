import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradeScreen } from "@/components/screen/TradeScreen";
import {
  MARKET_ORDER,
  MARKET_SLUGS,
  marketFromSlug,
  marketMeta,
} from "@/lib/markets";

// Pre-render one static shell per market: /btc, /eth, /sol. Each is a tiny HTML
// page whose only real difference is its <title>/description/OG — the client
// TradeScreen renders identically once hydrated.
export function generateStaticParams() {
  return MARKET_ORDER.map((sym) => ({ market: MARKET_SLUGS[sym] }));
}

type Params = { market: string };

// Per-market metadata so a shared link (e.g. /eth) shows Ethereum's title +
// OG/Twitter image when pasted into X, Discord, Telegram, etc. Crawlers read this
// server-rendered <meta>; they never run the client JS, which is exactly why the
// market has to live in the URL.
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { market } = await params;
  const symbol = marketFromSlug(market);
  if (!symbol) return {};
  const meta = marketMeta(symbol);
  const url = `/${MARKET_SLUGS[symbol]}`;
  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: url },
    openGraph: {
      title: meta.title,
      description: meta.description,
      url,
      siteName: "Tradash",
      type: "website",
      // Image comes from the co-located opengraph-image route (Next appends it).
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
    },
  };
}

export default async function MarketPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { market } = await params;
  const symbol = marketFromSlug(market);
  if (!symbol) notFound();
  return <TradeScreen initialMarket={symbol} />;
}
