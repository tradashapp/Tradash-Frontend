import type { Metadata } from "next";
import { LegalPage } from "@/components/landing/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy — Tradash",
  description: "How Tradash handles your data.",
};

// PLACEHOLDER CONTENT. This exists so the landing footer's Privacy link
// resolves; the wording has NOT been reviewed by a lawyer. Replace before
// launch.
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="20 August 2026">
      <p>
        <strong>This is a placeholder policy and is not legal advice.</strong>{" "}
        Replace this page with a reviewed policy before launch.
      </p>

      <h2>What we collect</h2>
      <p>
        Tradash is a non-custodial trading interface. We do not take custody of
        your funds. When you sign in, our authentication provider processes the
        identifier you sign in with (email, social account, or wallet address)
        so we can associate your trading account with you.
      </p>

      <h2>On-chain activity</h2>
      <p>
        Trades you place are settled on public infrastructure. Transactions,
        addresses, and positions recorded on-chain are inherently public and
        outside our control.
      </p>

      <h2>Local storage</h2>
      <p>
        Preferences (such as sound and display settings) and your session key are
        stored in your browser. Clearing site data removes them.
      </p>

      <h2>Contact</h2>
      <p>Questions about this policy can be sent to our support channels.</p>
    </LegalPage>
  );
}
