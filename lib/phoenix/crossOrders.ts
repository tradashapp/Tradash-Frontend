import { PHOENIX_API, PHOENIX_PROGRAM_ID } from "./config";

/**
 * Cross-margin order building, via the Rise SDK.
 *
 * WHY THE SDK HERE, WHEN EVERYTHING ELSE IS REST.
 *
 * Tradash is cross-margin only: positions share one collateral pool, and
 * `available` in the UI means "free collateral across the account". Phoenix's
 * REST order routes are ALL isolated-only — `/v1/ix/place-isolated-*` is the
 * complete list, `marginType:"cross"` is silently ignored, and every order
 * would shuffle collateral into a per-position subaccount. That would quietly
 * change what the balance UI means.
 *
 * The SDK has a cross path, and it is strictly simpler: ONE instruction against
 * the funded account instead of six with collateral transfers either side.
 * Measured live 2026-09-18.
 *
 * BUNDLE COST: ~474KB, which Next.js splits into its own chunk (measured:
 * 5,602,231 → 6,087,875 bytes of client JS). The SDK is therefore imported
 * DYNAMICALLY below so it never lands in the initial page load — only a user
 * who actually places an order pays for it.
 */

/** Phoenix's own order side spelling. Lowercase throws a codec error. */
type PhoenixSide = "Bid" | "Ask";

/** An instruction as the Rise SDK emits it (role bitfield, not booleans). */
interface SdkInstruction {
  programAddress: string;
  data: Uint8Array;
  accounts: { address: string; role: number }[];
}

/** Same shape the REST path produces, so downstream code is venue-uniform. */
export interface BuiltInstruction {
  programId: string;
  data: number[];
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
}

const ROLE_READONLY_SIGNER = 2;
const ROLE_WRITABLE_SIGNER = 3;
const ROLE_WRITABLE = 1;

/**
 * Convert an SDK instruction to the REST-shaped one the rest of `lib/phoenix`
 * already understands, so `signers.ts` and `submit.ts` work unchanged.
 */
function fromSdk(ix: SdkInstruction): BuiltInstruction {
  if (String(ix.programAddress) !== PHOENIX_PROGRAM_ID) {
    throw new Error(
      `Refusing instruction for ${ix.programAddress}, not Phoenix (${PHOENIX_PROGRAM_ID})`
    );
  }
  return {
    programId: String(ix.programAddress),
    data: Array.from(ix.data),
    keys: ix.accounts.map((a) => ({
      pubkey: String(a.address),
      isSigner: a.role === ROLE_READONLY_SIGNER || a.role === ROLE_WRITABLE_SIGNER,
      isWritable: a.role === ROLE_WRITABLE || a.role === ROLE_WRITABLE_SIGNER,
    })),
  };
}

/**
 * The SDK client, created once and reused.
 *
 * `createPhoenixClient` opens connections and caches exchange metadata, so a
 * per-order client would re-fetch it every time and burn rate limit. The import
 * is dynamic to keep the SDK out of the initial bundle.
 */
let clientPromise: Promise<unknown> | null = null;

async function getClient(rpcUrl: string) {
  if (!clientPromise) {
    clientPromise = (async () => {
      const rise = await import("@ellipsis-labs/rise");
      const client = rise.createPhoenixClient({ apiUrl: PHOENIX_API, rpcUrl });
      // Market params (tick size, lot decimals) are needed to turn a human
      // size into an order packet; without this the first order races metadata.
      await client.exchange.ready();
      return client;
    })();
  }
  return clientPromise as Promise<Awaited<ReturnType<typeof createClientType>>>;
}

// Type-only helper so `getClient` can be typed without importing the SDK eagerly.
declare function createClientType(): Promise<{
  orderPackets: {
    buildMarketOrderPacket(p: {
      symbol: string;
      side: PhoenixSide;
      baseUnits: string;
      priceLimitUsd?: number | string | null;
    }): Promise<unknown>;
  };
  ixs: {
    buildPlaceMarketOrder(p: {
      authority: string;
      positionAuthority?: string;
      symbol: string;
      orderPacket: unknown;
      traderPdaIndex?: number;
      traderSubaccountIndex?: number;
    }): Promise<SdkInstruction | SdkInstruction[] | { instructions: SdkInstruction[] }>;
  };
}>;

export interface CrossOrderParams {
  /** Owner wallet — the trader PDA derives from it; it does not sign. */
  authority: string;
  /** Delegate (session key) authorising the trade. */
  positionAuthority: string;
  /** Phoenix symbol, e.g. "SOL" (not Bulk's "SOL-USD"). */
  symbol: string;
  isBuy: boolean;
  /** Base-asset size in human units, e.g. 0.01 SOL. */
  size: number;
  rpcUrl: string;
  /**
   * Worst acceptable fill price. Phoenix market orders are IOC, so without a
   * bound a thin book can fill far from the screen price.
   */
  priceLimitUsd?: number;
}

/**
 * Build an UNSIGNED cross-margin market order.
 *
 * Returns REST-shaped instructions so the caller can assert the signer set and
 * submit through the same path the isolated route uses.
 *
 * Cross margin is `traderSubaccountIndex: 0` — the funded account. Any other
 * index is an isolated subaccount and would need its own collateral.
 */
export async function buildCrossMarketOrder(
  p: CrossOrderParams
): Promise<BuiltInstruction[]> {
  const client = await getClient(p.rpcUrl);

  const orderPacket = await client.orderPackets.buildMarketOrderPacket({
    symbol: p.symbol,
    // Capitalised on purpose: the SDK's codec rejects "bid"/"ask".
    side: p.isBuy ? "Bid" : "Ask",
    // `baseUnits` takes HUMAN units. Passing lots throws deep inside the
    // decimal parser with an unhelpful message.
    baseUnits: String(p.size),
    ...(p.priceLimitUsd != null ? { priceLimitUsd: p.priceLimitUsd } : {}),
  });

  const built = await client.ixs.buildPlaceMarketOrder({
    authority: p.authority,
    positionAuthority: p.positionAuthority,
    symbol: p.symbol,
    orderPacket,
    traderPdaIndex: 0,
    traderSubaccountIndex: 0,
  });

  const list: SdkInstruction[] = Array.isArray(built)
    ? built
    : "instructions" in (built as object)
      ? (built as { instructions: SdkInstruction[] }).instructions
      : [built as SdkInstruction];

  return list.map(fromSdk);
}
