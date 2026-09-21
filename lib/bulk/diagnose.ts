import { config, signatureDomain, nonceNs } from "@/lib/config";
import { ensureKeychain } from "./keychain";
import { fetchAccount } from "./client";

/**
 * Why can't this browser place an order?
 *
 * Every `bad signature` fix so far has been a THEORY about which of the moving
 * parts disagrees — stored key vs authorized key, signature domain vs network,
 * local flag vs account state. Theories are what kept this open, because the
 * one thing never actually inspected is the secret sitting in THIS browser.
 *
 * This reads that secret, derives its real pubkey, compares it to what the
 * account authorizes, and reports the answer instead of inferring it. It is
 * READ-ONLY: it never signs an order, never sends anything to Bulk except an
 * unsigned `/account` query, and never returns the secret itself.
 *
 * Call it from the devtools console: `window.__tradashDiagnose()`.
 */
export interface AgentDiagnosis {
  network: string;
  restUrl: string;
  signatureDomain: string;
  masterAddress: string;
  /** localStorage key actually read (shows whether network scoping applies). */
  storageKey: string;
  /** The `pubkey` FIELD in the stored blob — a label, not proof of anything. */
  storedPubkeyLabel: string | null;
  /** The pubkey DERIVED from the stored secret — what actually signs. */
  derivedPubkey: string | null;
  /** Does the stored label match the secret it is stored beside? */
  labelMatchesSecret: boolean | null;
  /** Is the DERIVED pubkey authorized on the account? This is the one that matters. */
  derivedIsAuthorized: boolean | null;
  /** Is the stored LABEL authorized? True + derivedIsAuthorized false = the trap. */
  labelIsAuthorized: boolean | null;
  authorizedAgentWallets: string[];
  builderCodeApprovals: { recipient: string; maxFee: number }[];
  builderConfigured: { recipient: string; feeBps: number };
  builderApprovalMatches: boolean;
  /** Plain-language conclusion. */
  verdict: string;
}

const PREFIX = "tradash.agent.v1:";

export async function diagnoseAgent(
  masterAddress: string
): Promise<AgentDiagnosis> {
  const domain = signatureDomain();
  const scopedKey = `${PREFIX}${config.bulk.network}:${masterAddress}`;
  const legacyKey = `${PREFIX}${masterAddress}`;

  // Prefer the scoped key, but report the legacy one when that is what exists —
  // a browser onboarded before network scoping still has its key there.
  let storageKey = scopedKey;
  let raw = window.localStorage.getItem(scopedKey);
  if (!raw) {
    const legacy = window.localStorage.getItem(legacyKey);
    if (legacy) {
      storageKey = legacyKey + "  (LEGACY, pre-network-scoping)";
      raw = legacy;
    }
  }

  let storedPubkeyLabel: string | null = null;
  let derivedPubkey: string | null = null;
  let secret: string | null = null;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { pubkey?: string; secretBase58?: string };
      storedPubkeyLabel = parsed.pubkey ?? null;
      secret = parsed.secretBase58 ?? null;
    } catch {
      /* corrupt blob — reported as a null label below */
    }
  }

  if (secret) {
    try {
      const kc = await ensureKeychain();
      derivedPubkey = kc.WasmSigner.fromBase58(secret, domain).pubkey;
    } catch (e) {
      derivedPubkey = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const acct = await fetchAccount(masterAddress).catch(() => null);
  const authorized = acct?.authorizedAgentWallets ?? [];
  const approvals = acct?.builderCodeApprovals ?? [];
  const { recipient, feeBps } = config.builder;
  const builderApprovalMatches = approvals.some(
    (a) => a.recipient === recipient && a.maxFee >= feeBps
  );

  const labelMatchesSecret =
    storedPubkeyLabel && derivedPubkey
      ? storedPubkeyLabel === derivedPubkey
      : null;
  const derivedIsAuthorized = derivedPubkey
    ? authorized.includes(derivedPubkey)
    : null;
  const labelIsAuthorized = storedPubkeyLabel
    ? authorized.includes(storedPubkeyLabel)
    : null;

  let verdict: string;
  if (!raw) {
    verdict =
      `NO AGENT KEY STORED at ${scopedKey}. If you onboarded before network ` +
      `scoping, the key is under ${legacyKey} and this build is not reading ` +
      `it. Re-run setup to issue one on this network.`;
  } else if (!secret) {
    verdict = "Stored blob has no secretBase58 — corrupt. Re-run setup.";
  } else if (derivedPubkey?.startsWith("ERROR:")) {
    verdict = `The stored secret could not be loaded: ${derivedPubkey}`;
  } else if (derivedIsAuthorized) {
    verdict = builderApprovalMatches
      ? "HEALTHY: the key in this browser is authorized and the builder code " +
        "is approved. A `bad signature` now points at the request itself " +
        "(nonce/domain/preimage), not at the key."
      : `The key is authorized, but NO builder-code approval matches ` +
        `${recipient} at >= ${feeBps}bps. Orders carry the builder code, so ` +
        `they are rejected. Re-run setup to approve it.`;
  } else if (labelIsAuthorized && labelMatchesSecret === false) {
    verdict =
      `THE MISMATCH: the stored LABEL (${storedPubkeyLabel}) is authorized, ` +
      `but the stored SECRET is for ${derivedPubkey}, which is NOT. Every ` +
      `signature is made by the unauthorized key while the UI reads the ` +
      `label and says "authorized". Re-run setup.`;
  } else {
    verdict =
      `The key this browser holds (${derivedPubkey}) is NOT among the ` +
      `${authorized.length} agents authorized on this account. Re-run setup ` +
      `so THIS key gets authorized.`;
  }

  return {
    network: config.bulk.network,
    restUrl: config.bulk.restUrl,
    signatureDomain: domain,
    masterAddress,
    storageKey,
    storedPubkeyLabel,
    derivedPubkey,
    labelMatchesSecret,
    derivedIsAuthorized,
    labelIsAuthorized,
    authorizedAgentWallets: authorized,
    builderCodeApprovals: approvals,
    builderConfigured: { recipient, feeBps },
    builderApprovalMatches,
    verdict,
  };
}

/** Unused here, but kept alongside so the console helper can show a live nonce. */
export const _nonceSample = nonceNs;
