/**
 * Server-side client for `api.leash.market`.
 *
 * The browser never holds an API key. Every public-facing fetch goes
 * through a Next.js server action / route handler that calls
 * `apiFetch(network, path)` with the right `lsh_test_*` /
 * `lsh_live_*` key for the active network.
 *
 * Configure with these env vars:
 *
 *   LEASH_API_URL                (default: https://api.leash.market)
 *   LEASH_EXPLORER_API_KEY_DEVNET   (lsh_test_…)
 *   LEASH_EXPLORER_API_KEY_MAINNET  (lsh_live_…)
 *
 * In a fully-offline dev mode (no API at all), we surface a structured
 * "api unreachable" error so pages can render a useful empty state
 * instead of crashing.
 */

import type { Network } from './network';

export type ApiError = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type ApiOk<T> = { ok: true; data: T };
export type ApiResult<T> = ApiOk<T> | ApiError;

const DEFAULT_API_URL = 'https://api.leash.market';

function apiUrl(): string {
  return process.env.LEASH_API_URL || DEFAULT_API_URL;
}

function apiKey(network: Network): string | null {
  if (network === 'mainnet') return process.env.LEASH_EXPLORER_API_KEY_MAINNET || null;
  return process.env.LEASH_EXPLORER_API_KEY_DEVNET || null;
}

export async function apiFetch<T>(
  network: Network,
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  const key = apiKey(network);
  if (!key) {
    return {
      ok: false,
      status: 0,
      code: 'api_key_missing',
      message: `No Leash API key configured for ${network}. Set LEASH_EXPLORER_API_KEY_${network.toUpperCase()}.`,
    };
  }
  const url = `${apiUrl().replace(/\/+$/, '')}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...(init ?? {}),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
        ...(init?.headers ?? {}),
      },
      cache: init?.cache ?? 'no-store',
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: 'api_unreachable',
      message: (err as Error).message || 'API unreachable',
    };
  }
  if (res.status === 404) {
    return { ok: false, status: 404, code: 'not_found', message: 'Not found on this network' };
  }
  if (!res.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await res.json()) as { error?: string; message?: string };
    } catch {
      // ignore
    }
    return {
      ok: false,
      status: res.status,
      code: body.error || `http_${res.status}`,
      message: body.message || res.statusText || 'API error',
    };
  }
  let json: T;
  try {
    json = (await res.json()) as T;
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      code: 'invalid_json',
      message: (err as Error).message,
    };
  }
  return { ok: true, data: json };
}

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

export type ReceiptRow = {
  v: '0.1';
  kind: 'spend' | 'earn';
  decision: 'allow' | 'deny' | 'rejected';
  agent: string;
  nonce: number;
  tx_sig?: string | null;
  reason?: string;
  price?: {
    amount: string;
    currency: string;
    asset?: string;
    network?: string;
  } | null;
  request_hash: string;
  prev_receipt_hash: string | null;
  receipt_hash: string;
  ts: string;
  payment_requirements_hash?: string | null;
};

export type ReceiptPage = {
  items: ReceiptRow[];
  cursor: string | null;
  has_more: boolean;
};

export type IndexerStatus = {
  network: 'solana-devnet' | 'solana-mainnet';
  watchlist_size: number;
  cursors: { total: number; last_run_at: string | null };
  events_last_hour: Record<string, number>;
};
