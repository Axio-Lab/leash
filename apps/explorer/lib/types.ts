/**
 * Wire types the explorer's pages and components consume.
 *
 * These deliberately use the same snake_case shape the public API
 * emits — matching the docs and the SDK contracts — so swapping the
 * underlying data source between HTTP and direct DB/RPC reads (which
 * is what we actually do here) is a no-op for the views.
 */

import type { ReceiptAny } from '@leashmarket/schemas';

export type EventRow = {
  id: string;
  ts: string;
  kind: string;
  phase: 'prepared' | 'submitted' | 'confirmed' | 'failed';
  network: 'solana-devnet' | 'solana-mainnet';
  client_reference: string | null;
  agent_asset: string | null;
  signature: string | null;
  mint: string | null;
  amount_atomic: string | null;
  metadata: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  confirmed_at: string | null;
  failed_at: string | null;
};

export type EventPage = {
  items: EventRow[];
  next_cursor: string | null;
};

export type AgentSummary = {
  agent_asset: string;
  network: 'solana-devnet' | 'solana-mainnet';
  treasury: string;
  has_identity: boolean;
  identity: { source: 'v1' | 'v2'; asset: string } | null;
  token: { has_token: boolean; mint: string | null; source: 'v1' | 'v2' | 'none' };
};

export type { IdentityDisclosureRead, PublicIdentityProfile } from '@leashmarket/schemas';

export type TreasuryBalances = {
  agent_asset: string;
  network: 'solana-devnet' | 'solana-mainnet';
  treasury: string;
  sol: { lamports: string; sol: number; spendable_lamports: string; spendable_sol: number };
  spl: Array<{
    mint: string;
    symbol: string | null;
    ata: string;
    token_program: string;
    amount: string;
    decimals: number;
    ui_amount: number;
  }>;
};

/**
 * The receipt shape consumed by `/receipt/<hash>` and the receipts
 * table: v0.1 x402 receipts or v0.2 dual-protocol (`parseReceiptAny`).
 */
export type ReceiptRow = ReceiptAny;

export type ReceiptPage = {
  items: ReceiptRow[];
  next_cursor: string | null;
};

export type IndexerStatus = {
  network: 'solana-devnet' | 'solana-mainnet';
  watchlist_size: number;
  cursors: { total: number; last_run_at: string | null };
  events_last_hour: Record<string, number>;
};

export type NativeSubscriptionPlan = {
  network: 'solana-devnet' | 'solana-mainnet';
  plan: string;
  agent_mint: string;
  merchant_wallet: string;
  plan_id: string;
  mint: string;
  token_program: string;
  symbol: string | null;
  amount_atomic: string;
  period_hours: string;
  status: 'active' | 'sunset';
  metadata_uri: string;
  metadata: Record<string, unknown>;
  create_tx_sig: string | null;
  update_tx_sig: string | null;
  last_event_id: string | null;
  created_at: string;
  updated_at: string;
};

export type NativeSubscription = {
  network: 'solana-devnet' | 'solana-mainnet';
  subscription: string;
  plan: string;
  agent_mint: string;
  subscriber_wallet: string;
  mint: string | null;
  status: 'active' | 'cancelled' | 'revoked';
  subscribe_tx_sig: string | null;
  last_tx_sig: string | null;
  last_event_id: string | null;
  created_at: string;
  updated_at: string;
};
