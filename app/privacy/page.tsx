import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/landing/LegalPage";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "Privacy Policy — Tradash",
  description: "What Tradash collects, why, who we share it with, and your choices.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="2 October 2026">
      <p>
        This policy explains what personal information Tradash (“we”, “us”)
        collects when you use our website, progressive web app, and mobile apps
        (together, the “Service”), how we use it, and the choices you have. By
        using the Service you agree to this policy. Our{" "}
        <Link href="/terms">Terms of Service</Link> apply alongside it.
      </p>

      <h2>1. The short version</h2>
      <ul>
        <li>
          Tradash is a non-custodial trading interface. Your funds sit in a
          wallet you control, not with us.
        </li>
        <li>
          We collect what we need to run your account: how you sign in, your
          wallet address, your trading history, and the profile you choose to
          show.
        </li>
        <li>
          Parts of your profile and trading statistics are{" "}
          <strong>public</strong> on the leaderboard. Anything recorded on a
          blockchain or on the Bulk exchange is outside our control.
        </li>
        <li>We do not sell your personal information or run advertising trackers.</li>
      </ul>

      <h2>2. What we collect</h2>
      <p>
        <strong>Account and sign-in data.</strong> Sign-in is handled by our
        authentication and wallet provider, Privy. Depending on how you sign in
        we receive and store an identifier for your account, the method you used
        (email, social account, or wallet), the linked accounts attached to it
        (for example an email address or an X username), and the address of the
        embedded Solana wallet created for you.
      </p>
      <p>
        <strong>Profile data you choose.</strong> Your username and profile
        picture. If you upload a picture it is stored in our file storage. You can
        change both at any time.
      </p>
      <p>
        <strong>Trading data.</strong> The orders, fills, positions, and closed
        trades on your account (market, direction, size, leverage, entry and exit
        price, fees, funding, profit and loss, take-profit and stop-loss levels,
        timestamps). We read this from the Bulk exchange and store a copy so we
        can show your history, statistics, and leaderboard ranking. For trades you
        close, we may also store a short recording of the price path (a “replay”)
        so you can watch it back.
      </p>
      <p>
        <strong>Funds movement data.</strong> Deposits, withdrawals, and transfers
        made through the Service: amount, token, network, status, destination
        address, and transaction signature. If you save addresses to your address
        book, we store the address and the label you give it.
      </p>
      <p>
        <strong>Trading session keys.</strong> To let you trade without approving
        every action, the Service creates a trading-only session key (an “agent
        key”) that you authorize on your account. It can place and cancel trades;
        it cannot withdraw funds to an outside address. A copy is stored on your
        device, and an encrypted copy is stored on our servers so your session
        can be restored on another device. If you use automated strategies (see
        our Terms), a separate server-generated key with the same limits is
        stored encrypted and used to run them.
      </p>
      <p>
        <strong>Referral and fee-code data.</strong> If you use a referral link or
        code, or a fee code, we record the code, who referred you, and the
        fee-sharing amounts that accrue from your trading. If you refer others,
        we see their trading volume and fees in order to calculate your rewards.
      </p>
      <p>
        <strong>Technical data.</strong> Our servers and hosting providers log
        requests, which can include your IP address, device and browser type,
        pages requested, and error details. We use Vercel Web Analytics to measure
        page visits in aggregate; it does not use advertising cookies.
      </p>
      <p>
        <strong>Messages.</strong> If you contact us, we keep the content of the
        conversation and the handle or address you contacted us from.
      </p>
      <p>
        We do not collect government ID, and we do not ask for or store your
        wallet’s private key or seed phrase.
      </p>

      <h2>3. What is public</h2>
      <p>
        When you trade, you appear on our leaderboards. Others can see your
        username, profile picture, linked X handle (if you linked one), wallet
        address, and aggregate statistics such as profit and loss, volume, return
        on capital, number of trades, and win count. If you share a trade card or
        a link, what is on the card is visible to whoever you share it with.
      </p>
      <p>
        Transactions, balances, and positions on the Solana blockchain and on the
        Bulk exchange are public or visible to the venue by design. We cannot edit
        or delete them, and anyone who knows your wallet address may be able to
        view that activity.
      </p>

      <h2>4. How we use information</h2>
      <ul>
        <li>To provide the Service: sign you in, show your account, trades, history, and statistics, and restore your session.</li>
        <li>To run the leaderboard, public profiles, and sharing features.</li>
        <li>To calculate and administer fees, fee codes, referral rewards, and rebates, and to check them against the exchange’s records.</li>
        <li>To sponsor network fees where we offer it, and to prevent that being abused.</li>
        <li>To secure the Service, detect fraud, abuse, and multi-account or wash-trading behavior, and fix bugs.</li>
        <li>To understand how the Service is used and improve it.</li>
        <li>To respond to you, and to meet legal and regulatory obligations.</li>
      </ul>
      <p>
        Where the law requires a legal basis, we rely on performing our contract
        with you, our legitimate interests in running and securing the Service,
        compliance with legal obligations, and your consent where we ask for it.
      </p>

      <h2>5. Who we share it with</h2>
      <p>We share information only as needed to run the Service:</p>
      <ul>
        <li>
          <strong>Privy</strong> — authentication and the embedded wallet.
        </li>
        <li>
          <strong>Bulk</strong> — the exchange where your orders are placed and
          settled. Your device and our servers communicate with it directly, so it
          receives your wallet address, signed orders, and technical data such as
          IP address. Its own terms and privacy practices apply.
        </li>
        <li>
          <strong>Infrastructure providers</strong> — our database and file
          storage (Supabase), hosting (Vercel and Render), email delivery for
          service and security messages (Resend), and Solana RPC and price-data
          providers.
        </li>
        <li>
          <strong>Other users</strong> — the public information described in
          section 3.
        </li>
        <li>
          <strong>Authorities and advisers</strong> — where required by law,
          legal process, or to protect our rights, users, or the Service, and to
          professional advisers under confidentiality.
        </li>
        <li>
          <strong>A successor</strong> — if Tradash is involved in a merger,
          acquisition, or sale of assets, information may transfer as part of
          that deal.
        </li>
      </ul>
      <p>We do not sell your personal information or share it for advertising.</p>

      <h2>6. Storage on your device</h2>
      <p>
        We store preferences (sound, display, default size and leverage), your
        trading session key, saved replays and history, and a pending referral
        code in your browser’s local storage, and use similar storage in the
        mobile apps. This is not used to track you across other sites. Clearing
        site data removes it; you may need to sign in and re-authorize trading
        afterwards.
      </p>

      <h2>7. Retention</h2>
      <p>
        We keep account, profile, and trading records for as long as your account
        exists and for a reasonable period afterwards where needed for security,
        dispute resolution, fee and referral accounting, and legal or tax
        obligations. Server logs are kept for a limited period. When we no longer
        need information we delete or anonymize it.
      </p>

      <h2>8. Security</h2>
      <p>
        We protect information with encryption in transit, encryption of stored
        session keys, access controls, and separation of duties for our admin
        tools. No system is perfectly secure. You are responsible for protecting
        your sign-in method and any devices and recovery methods connected to your
        wallet.
      </p>

      <h2>9. Your choices and rights</h2>
      <p>
        You can edit your username and picture in the app, revoke the trading
        session key from your account, and clear local data from your browser.
        Depending on where you live, you may also have the right to access,
        correct, delete, or export your personal information, to object to or
        restrict certain processing, to withdraw consent, and to complain to your
        data protection authority. To make a request, contact us using the
        details below. We may need to verify your identity first.
      </p>
      <p>
        If you ask us to delete your account we will delete or anonymize the
        personal information we hold, except what we must keep by law or for
        legitimate accounting and security purposes. We cannot delete anything
        recorded on a blockchain or held by Bulk or Privy; you would need to
        contact them directly.
      </p>

      <h2>10. International transfers</h2>
      <p>
        We and our providers operate in several countries, so your information may
        be processed outside the country where you live, including in countries
        whose data-protection laws differ from yours. Where required, we use
        appropriate safeguards for such transfers.
      </p>

      <h2>11. Children</h2>
      <p>
        The Service is for adults only. You must be at least 18 (or the age of
        majority where you live, if higher). We do not knowingly collect
        information from anyone younger. If you believe a child has given us
        information, contact us and we will delete it.
      </p>

      <h2>12. Third-party links</h2>
      <p>
        The Service links to third-party sites such as X, Discord, Telegram, and
        our documentation. We are not responsible for their content or privacy
        practices.
      </p>

      <h2>13. Changes</h2>
      <p>
        We may update this policy as the Service changes. We will change the “last
        updated” date above and, for material changes, give notice in the Service.
        Continuing to use the Service after a change means you accept the updated
        policy.
      </p>

      <h2>14. Contact</h2>
      <p>
        For privacy questions or requests, message us on{" "}
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
        . Please do not post sensitive personal information in public channels.
      </p>
    </LegalPage>
  );
}
