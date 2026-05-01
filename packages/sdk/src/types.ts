/**
 * Shared response types mirroring the public Leash API.
 *
 * These shapes are derived by hand from the OpenAPI doc the API
 * already serves at `/openapi.json`. We could auto-generate from
 * that source, but hand-rolling keeps the SDK runtime-light (zero
 * extra deps) and lets us rename fields when ergonomics improve.
 *
 * The shapes here are a strict subset of what the API returns —
 * fields you don't see are still present on the wire and reachable
 * via `as unknown as` for forward-compat.
 */

export type SvmNetwork = 'solana-devnet' | 'solana-mainnet';

export type DiscoverItem = {
  url: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  price_usdc: string | null;
  pricing_type: 'free' | 'per_call' | 'variable';
  seller_agent_mint: string | null;
  seller_wallet: string;
  rating: number | null;
  health_status: 'ok' | 'warn' | 'down' | null;
  tags: string[];
  tools: Array<{ name: string; description: string }>;
};

export type DiscoverResponse = {
  items: DiscoverItem[];
  next_cursor: string | null;
};

export type ReputationSnapshot = {
  agent_mint: string;
  network: SvmNetwork;
  total_volume_usdc: string;
  settled_calls: number;
  denied_calls: number;
  distinct_counterparties: number;
  dispute_rate: number;
  oldest_receipt_at: string | null;
  newest_receipt_at: string | null;
  rating: number;
};

export type Receipt = {
  receipt_hash: string;
  network: SvmNetwork;
  agent: string;
  nonce: number;
  decision: string;
  kind: 'spend' | 'earn' | 'denied';
  tx_sig: string | null;
  ingested_at: string;
  raw: {
    request?: { url?: string; method?: string };
    price?: { amount?: string; currency?: string; asset?: string; network?: string };
  } & Record<string, unknown>;
};

export type ReceiptsResponse = {
  items: Receipt[];
  next_cursor: string | null;
};

export type AgentWebhook = {
  id: string;
  agent_mint: string;
  network: SvmNetwork;
  url: string;
  events: string[];
  disabled_at: string | null;
  created_at: string;
};

export type AgentWebhookWithSecret = AgentWebhook & { secret: string };

/**
 * Input for {@link LeashClient.recordAgent}. Mirrors `RecordMintBody`
 * in `apps/api/src/routes/agent-self-register.ts`.
 *
 * Agent provisioning is fully client-side — generate (or import) an
 * executive keypair, fund it with SOL, then mint the MPL Core asset
 * locally with `@leash/mcp::mintAgentLocally` (or your own Umi setup).
 * Once the asset is on-chain, call `recordAgent` to write the
 * platform row + receipts feed metadata.
 */
export type RecordAgentInput = {
  /** MPL Core asset address. Must already exist on `network`. */
  mint: string;
  /** Caller-controlled ed25519 pubkey that owns the asset. */
  executive_pubkey: string;
  name: string;
  description?: string;
  image_url?: string;
  services?: { name: string; endpoint: string }[];
  network?: SvmNetwork;
};

export type RecordAgentResponse = {
  mint: string;
  treasury: string;
  executive_pubkey: string;
  network: SvmNetwork;
  receipts_service: string;
};

// ── payment links ────────────────────────────────────────────────
//
// Mirrors `apps/api/src/routes/payment-links.ts`. A payment link is
// a hosted x402 paywall — the API serves `/x/{id}` for buyers, and
// the agent's Asset Signer PDA is the on-chain `pay_to`. The SDK
// gives you typed CRUD; to *pay* one programmatically you need
// `@leash/buyer-kit` (Solana signing) or `@leash/mcp`'s host.

export type StableSymbol = 'USDC' | 'USDG';
export type EndpointMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type PaymentLinkResponseTemplate = {
  status: number;
  mimeType: string;
  body: string | Record<string, unknown>;
};

export type LeashFeeExtra = {
  v: '1';
  bps: number;
  feeAuthority: string;
};

export type PaymentLinkAcceptsEntry = {
  scheme: 'exact';
  network: string;
  pay_to: string;
  asset: string;
  amount: string;
  currency: StableSymbol;
  fee_amount: string;
  gross_amount: string;
  fee_bps: number;
  fee_authority: string;
  leash_fee: LeashFeeExtra;
};

export type PaymentLink = {
  id: string;
  network: SvmNetwork;
  label: string;
  description: string | null;
  owner_agent: string;
  owner_wallet: string | null;
  pay_to: string;
  method: EndpointMethod;
  path: string;
  price: string;
  currency: StableSymbol;
  accepts_currencies: StableSymbol[];
  response: PaymentLinkResponseTemplate;
  webhook_url: string | null;
  wrap_receipt: boolean;
  metadata: Record<string, unknown>;
  facilitator: string;
  share_url: string;
  accepts: PaymentLinkAcceptsEntry[];
  counters: {
    call_count: number;
    settled_count: number;
    last_called_at: string | null;
    last_settled_at: string | null;
    last_tx_sig: string | null;
    last_settled_amount_atomic: string | null;
    last_settled_currency: string | null;
  };
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentLinksListResponse = {
  items: PaymentLink[];
  next_cursor: string | null;
};

export type PaymentLinkCreateInput = {
  id?: string;
  label: string;
  description?: string;
  owner_agent: string;
  owner_wallet?: string;
  method?: EndpointMethod;
  price: string;
  currency?: StableSymbol;
  accepts_currencies?: StableSymbol[];
  response: PaymentLinkResponseTemplate;
  webhook_url?: string;
  wrap_receipt?: boolean;
  metadata?: Record<string, unknown>;
};

export type PaymentLinkPatchInput = Partial<{
  label: string;
  description: string | null;
  price: string;
  currency: StableSymbol;
  accepts_currencies: StableSymbol[];
  response: PaymentLinkResponseTemplate;
  webhook_url: string | null;
  wrap_receipt: boolean;
  metadata: Record<string, unknown>;
  disabled: boolean;
}>;
