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

import type {
  IdentityVerificationDecision,
  PublicIdentitySummary,
  SvmNetwork,
} from '@leashmarket/schemas';

export type {
  IdentityCapabilityRequirement,
  IdentityCapabilityCard,
  IdentityClaim,
  IdentityDisclosureCreateResponse,
  IdentityDisclosureGrant,
  IdentityDisclosureRead,
  IdentityDisclosureResource,
  IdentitySelector,
  IdentityVerificationDecision,
  IdentityVerificationDecisionProfile,
  IdentityVerificationDecisionRequest,
  IdentityVerificationThresholds,
  IdentityVerifyResponse,
  OperatorHistoryEntry,
  PublicIdentityProfile,
  PublicIdentitySummary,
  SellerIdentityMetadata,
  SellerIdentityMetadataEnvelope,
  SvmNetwork,
} from '@leashmarket/schemas';

export type DiscoverSource = 'leash' | 'pay-skills';

export type DiscoverItem = {
  /**
   * Catalogue this entry came from. `'leash'` items are agents listed
   * on the Leash marketplace; `'pay-skills'` items come from the
   * Solana Foundation `pay-skills` registry
   * (https://github.com/solana-foundation/pay-skills) and have no
   * on-chain seller identity.
   */
  source: DiscoverSource;
  url: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  price_usdc: string | null;
  pricing_type: 'free' | 'per_call' | 'variable';
  seller_agent_mint: string | null;
  /** Owner wallet for Leash entries; null for pay-skills entries. */
  seller_wallet: string | null;
  rating: number | null;
  /** Public seller identity summary for Leash-native listings. Null for legacy/pay-skills. */
  seller_identity: PublicIdentitySummary | null;
  health_status: 'ok' | 'warn' | 'down' | null;
  endpoint_count?: number;
  tags: string[];
  tools: Array<{ name: string; description: string }>;
  endpoints?: Array<{ method: string; url: string; description: string }>;
};

export type MarketplaceListing = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  owner_privy_id: string;
  owner_wallet: string;
  seller_agent_mint: string | null;
  seller_identity: PublicIdentitySummary | null;
  endpoint: string;
  pricing: {
    type: 'free' | 'per_call' | 'variable';
    amount?: string;
    currency?: 'USDC' | 'USDT' | 'USDG';
  };
  endpoints: Array<{
    method: 'GET' | 'POST';
    url: string;
    description: string;
    pricing?: {
      type: 'free' | 'per_call' | 'variable';
      amount?: string;
      currency?: 'USDC' | 'USDT' | 'USDG';
    };
    protocol?: Array<'x402' | 'mpp'>;
    supported_usd?: Array<'USDC' | 'USDT' | 'USDG'>;
  }>;
  docs_url: string | null;
  free_tier: number;
  health_status: 'ok' | 'warn' | 'down' | null;
  health_checked: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'disabled';
  created_at: string;
};

export type MarketplaceListingDetail = {
  listing: MarketplaceListing;
  rating: { avg: number; count: number };
  identity_verification: IdentityVerificationDecision | null;
};

export type DiscoverResponse = {
  items: DiscoverItem[];
  next_cursor: string | null;
};

/**
 * Per-endpoint pricing block as published by the pay-skills catalogue.
 * Most endpoints today are simple flat-rate per-call (a single `tiers`
 * entry with `price_usd`); usage-based and tiered pricing share the
 * same shape so callers should always inspect `mode` first.
 */
export type PaySkillsEndpointPricing = {
  mode?: string;
  dimensions?: Array<{
    direction?: string;
    scale?: number;
    unit?: string;
    tiers?: Array<{ price_usd?: number; threshold?: number }>;
  }>;
};

export type PaySkillsEndpoint = {
  method: string;
  /** Path relative to `service_url`. */
  path: string;
  /** Absolute URL (`service_url` + `path`) — what the buyer calls. */
  url: string;
  description?: string;
  resource?: string;
  pricing?: PaySkillsEndpointPricing | null;
  /** Payment protocols supported, e.g. `['x402']`. */
  protocol?: string[];
  /** Stablecoin symbols accepted, e.g. `['USDC']` or `['USDC','USDT']`. */
  supported_usd?: string[];
  /** `'ok'` when the catalogue's last live probe matched the expected challenge. */
  probe_status?: string;
  probe_description?: string;
};

export type PaySkillsProvider = {
  /** Fully qualified name, e.g. `agentmail/email`. */
  fqn: string;
  title: string;
  description: string;
  use_case?: string;
  category: string;
  service_url: string;
  version?: string;
  endpoints: PaySkillsEndpoint[];
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

/**
 * Per-day bucket emitted by {@link LeashClient.dailyTransactions}.
 * Stable USD totals are summed at 1:1 across USDC/USDG/USDT.
 */
export type DailyTxBucket = {
  date: string;
  sent_count: number;
  sent_usd: string;
  received_count: number;
  received_usd: string;
  net_usd: string;
};

export type DailyTransactionsResponse = {
  agent_mint: string;
  network: SvmNetwork;
  range: { from: string; to: string; days: number };
  daily: DailyTxBucket[];
  totals: {
    sent_count: number;
    sent_usd: string;
    received_count: number;
    received_usd: string;
    net_usd: string;
    non_usd_count: number;
  };
  truncated: boolean;
};

export type TransactionHistoryItem = {
  receipt_hash: string;
  direction: 'outgoing' | 'incoming';
  decision: string;
  tx_signature: string | null;
  url: string | null;
  method: string | null;
  amount: string | null;
  currency: string | null;
  timestamp: string;
};

export type TransactionHistoryResponse = {
  agent_mint: string;
  network: SvmNetwork;
  range: { from: string; to: string; days: number };
  direction: 'both' | 'outgoing' | 'incoming';
  count: number;
  truncated: boolean;
  total_sent_usd: string;
  total_received_usd: string;
  net_usd: string;
  sent_count: number;
  received_count: number;
  non_usd_count: number;
  items: TransactionHistoryItem[];
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
 * locally with `@leashmarket/mcp::mintAgentLocally` (or your own Umi setup).
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
// `@leashmarket/buyer-kit` (Solana signing) or `@leashmarket/mcp`'s host.

export type StableSymbol = 'USDC' | 'USDT' | 'USDG';
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
  /**
   * Free-form metadata. Set `metadata.upstream_url` to monetize an existing
   * HTTP endpoint; after settlement, the hosted paywall forwards the paid
   * request to that upstream URL instead of returning only the response template.
   * For POST endpoints, set `metadata.expected_request_body` to an arbitrary
   * JSON object that describes the body buyers should send to the hosted URL.
   * This is documentation/discovery metadata, not the live request body.
   */
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
