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

export type SandboxAgentResponse = {
  mint: string;
  treasury: string;
  executive_pubkey: string;
  executive_secret_base58: string;
  network: SvmNetwork;
  funded: { sol_lamports: string; usdc_atomic: string };
  tx_signatures: string[];
  explorer_urls: { mint: string; treasury: string };
};
