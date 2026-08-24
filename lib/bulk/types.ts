// Bulk Exchange API types. Shapes verified from docs.bulk.trade (2026-07-25).
// The API uses compact field notation inside an `actions` array; a request is
// an envelope of { actions, nonce, account, signer, signature }.

export interface BuilderCode {
  /** Recipient pubkey (base58) that collects our builder fee. */
  to: string;
  /** Fee in basis points, 1..=15. */
  fee: number;
}

/** Market order action. `b` true = buy/long. Close = opposite side + r:true. */
export interface MarketOrderAction {
  m: {
    c: string; // symbol, e.g. "BTC-USD"
    b: boolean; // is_buy
    sz: number; // size (base asset)
    r: boolean; // reduce-only
    i: boolean; // isolated routing
    /** Omit entirely when not routing a builder fee (null is rejected). */
    builderCode?: BuilderCode;
  };
}

/** Register (d:false) or remove (d:true) an agent wallet. Master-signed. */
export interface AgentWalletAction {
  agentWalletCreation: {
    a: string; // agent pubkey (base58)
    d: boolean; // false = register, true = remove
  };
}

/** Approve a builder code (sets the fee cap). Master-signed. */
export interface ApproveBuilderAction {
  abc: BuilderCode;
}

/** Revoke a builder code. Master-signed. */
export interface RevokeBuilderAction {
  rbc: { to: string };
}

export type BulkAction =
  | MarketOrderAction
  | AgentWalletAction
  | ApproveBuilderAction
  | RevokeBuilderAction;

/** The canonical part that gets signed. */
export interface SigningPayload {
  actions: BulkAction[];
  nonce: string; // u64 NANOSECONDS as a string — see nonceNs() in lib/config
  account: string; // base58 pubkey being traded
}

/** Full request envelope posted to /order. */
export interface OrderEnvelope extends SigningPayload {
  signer: string; // who signed (master == account, or agent pubkey)
  signature: string; // base58 ed25519 signature
}

// --- Responses ---------------------------------------------------------------

export interface OrderResponse {
  status: string; // "ok"
  response?: {
    type: string; // "order"
    data?: {
      statuses?: OrderStatusEntry[];
    };
  };
  error?: string;
}

export type OrderStatusEntry =
  | { filled: { oid?: number; sz?: number; avgPx?: number } }
  | { resting: { oid?: number } }
  | { agentWallet: { agent_wallet: string } }
  | { agentWalletFailed: { message: string } }
  | { error: { message: string } }
  | Record<string, unknown>;

// --- Account query (POST /account, unsigned) ---------------------------------

export interface AccountQuery {
  type: "fullAccount" | "openOrders" | "fills";
  user: string; // base58
  symbol?: string;
}

// --- Real /account response shape (verified live 2026-07-26) ------------------
// POST /account returns an ARRAY: [{ fullAccount: {...} }]. The account nests
// margin + positions with these exact field names.

/**
 * Account margin. Bulk RENAMED these fields (observed live 2026-08-22): what was
 * `totalBalance` / `availableBalance` is now `totalMargin` / `availableMargin`.
 * The old names are gone from both REST and the WS, so reading them yielded
 * `undefined` → equity 0 and a total balance that showed collateral only, with
 * unrealized PnL never added in. Both spellings are kept optional so we tolerate
 * either shape; use `readMargin()` to normalize.
 */
export interface BulkMargin {
  /** Current name for total account equity (includes unrealized PnL). */
  totalMargin?: number;
  /** Current name for free balance available as new margin. */
  availableMargin?: number;
  /** Legacy names, pre-2026-08-22. */
  totalBalance?: number;
  availableBalance?: number;
  /** Free collateral that can actually be moved out. */
  transferableBalance?: number;
  marginUsed?: number;
  notional?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
  fees?: number;
  funding?: number;
}

/** Normalized margin figures, independent of which field spelling Bulk sent. */
export interface NormalizedMargin {
  equity: number;
  available: number;
  marginUsed: number;
  unrealizedPnl: number;
}

/**
 * Read Bulk's margin under either field spelling. Returns `null` for any figure
 * the payload did not carry, so callers can distinguish "absent" from a real 0
 * (defaulting to 0 is exactly what blanked the balance).
 */
export function readMargin(m: BulkMargin | undefined | null): {
  equity: number | null;
  available: number | null;
  marginUsed: number | null;
  unrealizedPnl: number | null;
} {
  const pick = (...vals: (number | undefined)[]) => {
    for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  };
  return {
    equity: pick(m?.totalMargin, m?.totalBalance),
    available: pick(m?.availableMargin, m?.availableBalance),
    marginUsed: pick(m?.marginUsed),
    unrealizedPnl: pick(m?.unrealizedPnl),
  };
}

export interface BulkPosition {
  symbol: string;
  size: number; // signed: >0 long, <0 short
  price: number; // avg entry
  fairPrice: number; // current mark price
  notional: number;
  realizedPnl: number;
  unrealizedPnl: number;
  leverage: number;
  liquidationPrice: number;
  maintenanceMargin: number;
  iso: boolean;
}

export interface BulkFullAccount {
  kind: string; // "MasterEOA"
  name: string | null;
  authorizedAgentWallets: string[];
  margin: BulkMargin;
  positions: BulkPosition[];
  openOrders: unknown[];
  leverageSettings: { symbol: string; leverage: number }[];
}

/** The raw array item returned by POST /account. */
export interface AccountResponseItem {
  fullAccount: BulkFullAccount;
}
