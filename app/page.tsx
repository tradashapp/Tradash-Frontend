import { TradeScreen } from "@/components/screen/TradeScreen";
import { DEFAULT_MARKET } from "@/lib/markets";

// The homepage IS the trading screen. Defaults to BTC; the shared TradeScreen
// syncs the URL to /btc on load and to /eth, /sol as the market changes in-app.
// Per-market metadata/OG live on the /[market] routes.
export default function Home() {
  return <TradeScreen initialMarket={DEFAULT_MARKET} />;
}
