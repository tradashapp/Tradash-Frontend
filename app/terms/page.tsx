import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service — Tradash",
  description: "The terms governing your use of Tradash.",
};

// PLACEHOLDER CONTENT. This exists so the landing footer's Terms link resolves;
// the wording has NOT been reviewed by a lawyer. Replace before launch.
export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="20 August 2026">
      <p>
        <strong>These are placeholder terms and are not legal advice.</strong>{" "}
        Replace this page with reviewed terms before launch.
      </p>

      <h2>Risk</h2>
      <p>
        Trading perpetual futures involves substantial risk of loss, amplified by
        leverage. You can lose your entire margin. Only trade with funds you can
        afford to lose. Nothing in the product is financial advice.
      </p>

      <h2>The demo on our homepage</h2>
      <p>
        The interactive phone demo on our homepage runs a{" "}
        <strong>simulated</strong> price feed with a scripted, always-profitable
        outcome. It illustrates the interface only. It is not a backtest, not
        historical data, and not representative of real trading results.
      </p>

      <h2>Non-custodial</h2>
      <p>
        You control your keys and your funds. We do not hold, transmit, or have
        the ability to move your assets.
      </p>

      <h2>Availability</h2>
      <p>
        The service is provided as-is, without warranty. Access may be
        interrupted for maintenance, upstream outages, or reasons outside our
        control.
      </p>
    </LegalPage>
  );
}
