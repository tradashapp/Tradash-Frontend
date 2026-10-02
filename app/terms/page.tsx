import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/landing/LegalPage";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Terms of Service — Tradash",
  description: "The terms governing your use of Tradash.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="2 October 2026">
      <p>
        These Terms govern your use of the Tradash website, progressive web app,
        and mobile apps (the “Service”), operated by Tradash (“we”, “us”). By
        accessing or using the Service you agree to these Terms and to our{" "}
        <Link href="/privacy">Privacy Policy</Link>. If you do not agree, do not use
        the Service.
      </p>

      <h2>1. What Tradash is</h2>
      <p>
        Tradash is an interface for trading perpetual futures. Orders you place
        through Tradash are executed and settled on the Bulk exchange (“Bulk”), a
        third-party venue, using a Solana wallet that is created for you through
        our wallet provider, Privy. Tradash is not an exchange, broker, dealer,
        investment adviser, or custodian, and we do not execute or clear trades
        ourselves.
      </p>

      <h2>2. Eligibility</h2>
      <p>You may use the Service only if you:</p>
      <ul>
        <li>are at least 18 years old and able to enter a binding contract;</li>
        <li>
          are not located in, or a resident or national of, a country or region
          where trading these products is prohibited or restricted, or where
          using the Service would violate applicable law;
        </li>
        <li>
          are not the subject of economic sanctions or on any sanctions or
          restricted-party list, and are not acting for someone who is; and
        </li>
        <li>
          are using the Service for yourself, with funds that lawfully belong to
          you.
        </li>
      </ul>
      <p>
        You are responsible for knowing and complying with the laws that apply to
        you, including tax law. We may restrict or block access from any location
        or to any person at any time.
      </p>

      <h2>3. Risk</h2>
      <p>
        <strong>
          Trading perpetual futures involves substantial risk of loss, amplified
          by leverage. You can lose your entire margin, and positions can be
          liquidated automatically and quickly.
        </strong>{" "}
        Prices can gap or move sharply, markets can be illiquid, and orders,
        stop-losses, and take-profits may fill at worse prices than expected or
        not at all. Funding rates and fees reduce your results. Crypto assets,
        blockchains, and software can fail or be exploited. Only trade with funds
        you can afford to lose.
      </p>
      <p>
        Nothing in the Service is financial, investment, legal, or tax advice, or
        a recommendation to trade. Charts, statistics, leaderboards, and shared
        trades describe the past and do not predict future results. You make your
        own decisions.
      </p>

      <h2>4. The demo on our homepage</h2>
      <p>
        The interactive phone demo on our homepage runs a <strong>simulated</strong>{" "}
        price feed with a scripted, always-profitable outcome. It illustrates the
        interface only. It is not a backtest, not historical data, and not
        representative of real trading results.
      </p>

      <h2>5. Your account and wallet</h2>
      <p>
        You sign in through Privy using an email, social account, or wallet. You
        are responsible for keeping your sign-in methods, devices, and any
        recovery options secure, and for everything done through your account. We
        cannot reverse blockchain transactions or recover access that you have
        lost. Tell us promptly if you suspect unauthorized use.
      </p>

      <h2>6. Non-custodial, and the trading session key</h2>
      <p>
        You control your wallet and your funds. We do not hold your funds, and we
        cannot withdraw them or send them to an outside address. Withdrawals and
        external transfers require your signature.
      </p>
      <p>
        To let you trade quickly, you authorize a trading-only session key (an
        “agent key”) on your Bulk account. That key can place and cancel orders on
        your behalf, and an encrypted copy is kept on our servers so your session
        works across devices. It cannot withdraw to an outside address. You can
        revoke it at any time, and you are responsible for the trades placed with
        it while it is authorized. We use it only to carry out actions you request
        or, if you enable automated strategies (section 9), to run those
        strategies as you configured them.
      </p>

      <h2>7. Fees</h2>
      <p>
        Bulk charges its own trading and funding fees, set by Bulk, which are
        separate from ours. In addition, Tradash charges a builder fee on orders
        that open a position, which Bulk collects and passes to us. The current
        rate is shown in the app and is capped at the maximum you approved when
        you set up your account. Fee codes, where we offer them, can reduce only
        the Tradash builder fee, never Bulk’s fees. We may change our fees
        prospectively; changes that exceed the maximum you approved require your
        fresh approval.
      </p>
      <p>
        Network fees (for example Solana transaction fees) apply to on-chain
        actions. We may, at our discretion, sponsor some of them, and may limit
        or stop doing so at any time.
      </p>

      <h2>8. Leaderboard, profiles, and referrals</h2>
      <p>
        By using the Service you agree that your username, profile picture,
        linked X handle, wallet address, and aggregate trading statistics may be
        shown publicly on leaderboards and profiles, as described in our Privacy
        Policy. Do not use a username or picture that is unlawful, infringing,
        misleading, hateful, or that impersonates someone else; we may remove or
        change any we consider inappropriate.
      </p>
      <p>
        Our referral program, where available, is governed by the rules shown in
        the app, which we may change or end at any time. Referral rewards and
        rebates accrue from builder fees on qualifying trades, are paid at our
        discretion and on our schedule, and are never owed for self-referral,
        multiple accounts, wash trading, or other manipulation. We may void
        accruals and disable codes where we detect it.
      </p>

      <h2>9. Automated strategies (beta)</h2>
      <p>
        We may offer automated strategies, such as grid bots, to selected users.
        These are experimental. A strategy places orders automatically using a
        server-held key, can move funds between your main account and dedicated
        sub-accounts, and can lose money, including quickly in trending or
        volatile markets. Stop conditions and protections reduce but do not
        remove risk and depend on exchange and infrastructure availability. You
        choose the settings and capital and are responsible for the results. We
        may limit, pause, or withdraw access to them at any time.
      </p>

      <h2>10. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>break the law, or use the Service for money laundering, terrorist financing, sanctions evasion, or fraud;</li>
        <li>manipulate markets, wash trade, or collude to inflate volume, rankings, or rewards;</li>
        <li>create multiple accounts to abuse referrals, fee codes, sponsored fees, or promotions;</li>
        <li>interfere with or overload the Service, probe or attack its security, or bypass its limits or access controls;</li>
        <li>scrape, reverse engineer, or copy the Service beyond what the law allows, or use it to build a competing product;</li>
        <li>modify the app to avoid or misreport fees; or</li>
        <li>use another person’s account or help anyone else do any of the above.</li>
      </ul>
      <p>
        We may suspend or limit access, void rewards, and cooperate with
        authorities if we reasonably believe you have breached these Terms or the
        law.
      </p>

      <h2>11. Third-party services</h2>
      <p>
        The Service depends on third parties, including Bulk, Privy, the Solana
        network, and data and infrastructure providers. They are outside our
        control. Their outages, delays, price errors, rule changes, security
        incidents, or decisions (including to restrict or close your account with
        them) are not our responsibility, and their own terms apply to your use
        of them.
      </p>

      <h2>12. Intellectual property</h2>
      <p>
        The Service, including its software, design, name, and logos, belongs to
        us or our licensors and is protected by law. We give you a limited,
        revocable, non-exclusive, non-transferable license to use the Service as
        these Terms allow. You keep ownership of content you submit (such as your
        profile picture) and give us a worldwide, royalty-free license to host,
        display, and use it to operate and promote the Service, including on
        leaderboards and shared cards.
      </p>

      <h2>13. Availability and changes</h2>
      <p>
        The Service is provided “as is” and “as available”. Access may be
        interrupted or limited for maintenance, upstream outages, security, legal
        reasons, or other causes outside our control. We may change, suspend, or
        discontinue any part of the Service at any time. Prices, balances, and
        profit-and-loss figures shown are for convenience and may be delayed or
        differ from the exchange’s records, which are authoritative.
      </p>

      <h2>14. Disclaimers</h2>
      <p>
        To the fullest extent permitted by law, we disclaim all warranties,
        express or implied, including merchantability, fitness for a particular
        purpose, non-infringement, accuracy, and uninterrupted or error-free
        operation. We do not warrant that the Service will meet your needs, that
        any strategy or feature will be profitable, or that orders will execute
        at the price or time you expect.
      </p>

      <h2>15. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, we and our affiliates, officers,
        contributors, and service providers are not liable for any indirect,
        incidental, special, consequential, or punitive damages, or for lost
        profits, trading losses, liquidations, lost data, or loss of goodwill,
        arising from or related to the Service, even if advised of the
        possibility. Our total liability for any claim relating to the Service
        is limited to the greater of the fees we received from you in the 12
        months before the claim and US$100. Some jurisdictions do not allow
        certain limits, so some of this may not apply to you, and nothing here
        limits liability that cannot be limited by law.
      </p>

      <h2>16. Indemnity</h2>
      <p>
        You agree to defend and indemnify us and our affiliates, officers, and
        contributors against claims, losses, and expenses (including reasonable
        legal fees) arising from your use of the Service, your content, your
        breach of these Terms, or your violation of any law or third-party right.
      </p>

      <h2>17. Suspension and termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate
        your access at any time, with or without notice, including where required
        by law or where we suspect a breach. Because you hold your funds in your
        own wallet, termination does not take them from you, but you are
        responsible for closing positions and withdrawing. Sections that by their
        nature should survive termination will do so.
      </p>

      <h2>18. Disputes and governing law</h2>
      <p>
        We would like to hear about a problem first, so please contact us before
        starting a formal claim and give us a reasonable chance to resolve it.
        These Terms, and any dispute arising out of them or the Service, are
        governed by the laws of the jurisdiction in which the Tradash operator is
        established, without regard to conflict-of-laws rules, and the courts of
        that jurisdiction have exclusive jurisdiction, except where mandatory
        consumer law in your country gives you the right to bring a claim
        elsewhere. To the extent the law allows, claims must be brought on an
        individual basis and not as a class or representative action, and any
        claim must be filed within one year after it arises.
      </p>

      <h2>19. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. We will change the “last
        updated” date above and, for material changes, give notice in the Service.
        Continuing to use the Service after a change takes effect means you accept
        the updated Terms.
      </p>

      <h2>20. General</h2>
      <p>
        These Terms and the Privacy Policy are the entire agreement between you
        and us about the Service. If a provision is found unenforceable, the rest
        remains in effect. Our failure to enforce a right is not a waiver. You may
        not assign these Terms without our consent; we may assign them in a
        merger, acquisition, or sale of assets. We are not liable for delays or
        failures caused by events beyond our reasonable control, such as network
        failures, outages of third-party services, or changes in law.
      </p>

      <h2>21. Contact</h2>
      <p>
        Questions about these Terms? Reach us on{" "}
        <a href={config.social.discord} target="_blank" rel="noreferrer noopener">
          Discord
        </a>
        ,{" "}
        <a href={config.social.telegram} target="_blank" rel="noreferrer noopener">
          Telegram
        </a>
        , or{" "}
        <a href={config.social.x} target="_blank" rel="noreferrer noopener">
          X
        </a>
        .
      </p>
    </LegalPage>
  );
}
