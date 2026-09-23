/**
 * Bulk Aura — the exchange's points programme, read from Bulk's public indexer.
 *
 * The endpoint returns a lot more than we show (referral codes, deposit totals,
 * invite access). We pick out only the fields the Aura panel renders, so the
 * rest never reaches component state.
 *
 * Two ranks come back: `rank` orders wallets by deposits, `aura_rank` by Aura.
 * The panel is about Aura, so `aura_rank` is the one surfaced.
 */

const AURA_URL = "https://indexer.bulk.trade/v1/aura/wallet";

export interface AuraLeague {
  name: string;
  /** The league's bracket, e.g. 10 = "top 10%". */
  topPercent: number;
  /** Where this wallet sits, as a percentile from the top. */
  percentile: number;
}

export interface AuraCategory {
  key: string;
  points: number;
}

export interface Aura {
  points: number;
  rank: number | null;
  /** Null until the wallet has earned enough to be placed in a league. */
  league: AuraLeague | null;
  /** Largest first. */
  categories: AuraCategory[];
}

export async function fetchAura(wallet: string): Promise<Aura> {
  const res = await fetch(`${AURA_URL}/${encodeURIComponent(wallet)}`);
  if (!res.ok) throw new Error(`aura ${res.status}`);
  const d = await res.json();

  const league =
    d.league && typeof d.league.name === "string"
      ? {
          name: d.league.name as string,
          topPercent: Number(d.league.top_percent),
          percentile: Number(d.league.percentile),
        }
      : null;

  const categories = Object.entries(
    (d.categories ?? {}) as Record<string, number>,
  )
    .map(([key, points]) => ({ key, points: Number(points) || 0 }))
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points);

  return {
    points: Number(d.aura) || 0,
    rank: typeof d.aura_rank === "number" ? d.aura_rank : null,
    league,
    categories,
  };
}

const PHASES: Record<string, string> = {
  mainnet: "Mainnet",
  predeposit: "Pre-deposit",
  retro: "Retro",
};

/**
 * Turns an indexer category key into a title + context line.
 *
 *   mainnet_week2_trading       → "Trading"     · "Mainnet · Week 2"
 *   predeposit_referral_week13  → "Referral"    · "Pre-deposit · Week 13"
 *   predeposit_week10           → "Pre-deposit" · "Week 10"
 *   retro_alphanet              → "Retro"       · "Alphanet"
 *
 * Keys are free-form on Bulk's side, so anything unrecognised still reads as
 * title-cased words rather than a raw snake_case id.
 */
export function describeAuraCategory(key: string): {
  title: string;
  context: string;
} {
  const parts = key.split("_").filter(Boolean);
  const phaseKey = parts[0] ?? "";
  const phase = PHASES[phaseKey];
  const rest = phase ? parts.slice(1) : parts;

  let week: string | null = null;
  const words: string[] = [];
  for (const p of rest) {
    const m = /^week(\d+)$/i.exec(p);
    if (m) week = `Week ${m[1]}`;
    else words.push(capitalize(p));
  }

  // Retro rewards are named after the network they reward ("alphanet"), which
  // reads better as the context than as the title.
  if (!phase || phaseKey === "retro" || words.length === 0) {
    const title = phase ?? (words.shift() || capitalize(key));
    return {
      title,
      context: [...words, week].filter(Boolean).join(" · "),
    };
  }
  return {
    title: words.join(" "),
    context: [phase, week].filter(Boolean).join(" · "),
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
