import { TradeScreen } from "@/components/screen/TradeScreen";
import { DEFAULT_MARKET } from "@/lib/markets";

// The app entry. `/` is the marketing landing page, so the trading screen lives
// here. Defaults to BTC; the shared TradeScreen syncs the URL to /trade/btc on
// load and to /trade/eth, /trade/sol as the market changes in-app.
// Per-market metadata/OG live on the /trade/[market] routes.
export default function TradeHome() {
  return <TradeScreen initialMarket={DEFAULT_MARKET} />;
}
