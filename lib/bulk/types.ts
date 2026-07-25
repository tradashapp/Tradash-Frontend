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
  nonce: number; // u64, use Date.now()
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

export interface BulkPosition {
  symbol: string;
  size: number;
  price: number; // avg entry
  leverage: number;
  liquidationPrice: number;
  unrealizedPnl: number;
}

export interface FullAccount {
  equity: number;
  available: number;
  marginUsed: number;
  positions: BulkPosition[];
}
