import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradeScreen } from "@/components/screen/TradeScreen";
import { marketFromSlug, marketMeta, marketPath } from "@/lib/markets";

type Params = { market: string };

// Per-market metadata so a shared link (e.g. /trade/ETH) shows Ethereum's title +
// OG/Twitter image when pasted into X, Discord, Telegram, etc. Crawlers read this
// server-rendered <meta>; they never run the client JS, which is exactly why the
// market has to live in the URL. The OG image comes from the co-located
// opengraph-image route (Next appends it to the tags automatically).
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { market } = await params;
  const symbol = marketFromSlug(market);
  if (!symbol) return {};
  const meta = marketMeta(symbol);
  const url = marketPath(symbol);
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
