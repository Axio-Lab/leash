/**
 * Payment-link CRUD + paywall counters.
 *
 * A payment link is an identity-linked paid capability: an agent owner
 * declares `(method + price + response template)` and any x402-aware caller
 * can dial `https://api.leash.market/x/<id>` to either probe the offer
 * (gets a real `paymentRequirements[]` in a 402) or pay it (gets the
 * configured response).
 *
 * Records are scoped to (network, api_key_id):
 *   - `network` matches the prefix of the issuing API key, so devnet
 *     and mainnet stay strictly isolated even when the same slug is
 *     reused.
 *   - `api_key_id` is the *owning customer*. Reads, updates, and
 *     deletes through `/v1/payment-links/*` are gated by it.
 *   - The PUBLIC paywall (`/x/<id>`) ignores `api_key_id` and
 *     resolves only by `(network, id)` so anonymous buyers can pay.
 */

import type { KnownStableSymbol } from '@leashmarket/core';
import type { EndpointMethod } from '@leashmarket/schemas';

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { SvmNetwork } from '../util/network.js';

export type PaymentLinkProtocol = 'x402' | 'mpp';

/**
 * Verbatim response template returned to the buyer after a successful
 * x402 settlement. Mirrors `EndpointResponseTemplate` from
 * `@leashmarket/schemas` but kept JSON-friendly (record vs Zod record).
 */
export type PaymentLinkResponse = {
  status: number;
  mimeType: string;
  body: string | Record<string, unknown>;
};

export type PaymentLinkRow = {
  id: string;
  network: SvmNetwork;
  apiKeyId: string;
  label: string;
  description: string | null;
  ownerAgent: string;
  ownerWallet: string | null;
  method: EndpointMethod;
  /** Hono path the paywall mounts. Always `/x/<id>` today. */
  path: string;
  /** Display price string, e.g. `"$0.001"`. Parsed at advertise/settle time. */
  price: string;
  currency: KnownStableSymbol;
  acceptsCurrencies: KnownStableSymbol[];
  response: PaymentLinkResponse;
  webhookUrl: string | null;
  wrapReceipt: boolean;
  metadata: Record<string, unknown>;
  /** Hosted paywall protocol: x402 (`payment-required`) or MPP (`problem+json`). */
  protocol: PaymentLinkProtocol;
  /** Number of times the paywall was hit (any outcome). */
  callCount: number;
  /** Number of times the call settled successfully. */
  settledCount: number;
  lastCalledAt: string | null;
  lastSettledAt: string | null;
  lastTxSig: string | null;
  lastSettledAmountAtomic: string | null;
  lastSettledCurrency: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatePaymentLinkInput = {
  network: SvmNetwork;
  apiKeyId: string;
  /** Optional explicit slug; caller-supplied or auto-generated upstream. */
  id: string;
  label: string;
  description?: string | null;
  ownerAgent: string;
  ownerWallet?: string | null;
  method: EndpointMethod;
  path: string;
  price: string;
  currency: KnownStableSymbol;
  acceptsCurrencies?: KnownStableSymbol[];
  response: PaymentLinkResponse;
  webhookUrl?: string | null;
  wrapReceipt?: boolean;
  metadata?: Record<string, unknown>;
  protocol?: PaymentLinkProtocol;
};

export class PaymentLinkConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentLinkConflictError';
  }
}

export async function createPaymentLink(
  db: DbClient,
  input: CreatePaymentLinkInput,
): Promise<PaymentLinkRow> {
  const accepts = JSON.stringify(input.acceptsCurrencies ?? []);
  const responseJson = JSON.stringify(input.response);
  const metadataJson = JSON.stringify(input.metadata ?? {});
  const proto = normalizePaymentProtocol(input.protocol ?? 'x402');
  try {
    await execute(
      db,
      `INSERT INTO payment_links (
         id, network, api_key_id, label, description, owner_agent, owner_wallet,
         method, path, price, currency, accepts_currencies_json,
         response_json, webhook_url, wrap_receipt, metadata_json, payment_protocol
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.network,
        input.apiKeyId,
        input.label,
        input.description ?? null,
        input.ownerAgent,
        input.ownerWallet ?? null,
        input.method,
        input.path,
        input.price,
        input.currency,
        accepts,
        responseJson,
        input.webhookUrl ?? null,
        input.wrapReceipt ? 1 : 0,
        metadataJson,
        proto,
      ],
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (/UNIQUE|PRIMARY KEY/i.test(msg)) {
      throw new PaymentLinkConflictError(
        `payment link "${input.id}" already exists on ${input.network}`,
      );
    }
    throw err;
  }
  const created = await getPaymentLink(db, input.network, input.id);
  if (!created) throw new Error('payment link insert succeeded but lookup failed');
  return created;
}

/**
 * Public lookup — used by the `/x/{id}` paywall. NOT scoped to an API
 * key because the paywall is anonymously reachable.
 */
export async function getPaymentLink(
  db: DbClient,
  network: SvmNetwork,
  id: string,
): Promise<PaymentLinkRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM payment_links WHERE network = ? AND id = ? LIMIT 1`,
    [network, id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return rowToPaymentLink(row);
}

/**
 * Owner-scoped lookup — returns null if the link exists but belongs to
 * a different api_key. Use this from `/v1/payment-links/{id}` so one
 * customer can never see (or mutate) another's links.
 */
export async function getPaymentLinkScoped(
  db: DbClient,
  args: { network: SvmNetwork; apiKeyId: string; id: string },
): Promise<PaymentLinkRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM payment_links
       WHERE network = ? AND api_key_id = ? AND id = ?
       LIMIT 1`,
    [args.network, args.apiKeyId, args.id],
  );
  const row = res.rows[0];
  if (!row) return null;
  return rowToPaymentLink(row);
}

export type ListPaymentLinksArgs = {
  network: SvmNetwork;
  apiKeyId: string;
  ownerAgent?: string | null;
  includeDisabled?: boolean;
  cursor?: string | null;
  limit?: number;
};

export async function listPaymentLinks(
  db: DbClient,
  args: ListPaymentLinksArgs,
): Promise<PaymentLinkRow[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const filters: string[] = ['network = ?', 'api_key_id = ?'];
  const values: (string | number)[] = [args.network, args.apiKeyId];
  if (args.ownerAgent) {
    filters.push('owner_agent = ?');
    values.push(args.ownerAgent);
  }
  if (!args.includeDisabled) {
    filters.push('disabled_at IS NULL');
  }
  if (args.cursor) {
    filters.push('created_at < ?');
    values.push(args.cursor);
  }
  const sql = `SELECT * FROM payment_links
    WHERE ${filters.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  const res = await execute(db, sql, values);
  return res.rows.map(rowToPaymentLink);
}

export type UpdatePaymentLinkPatch = Partial<{
  label: string;
  description: string | null;
  price: string;
  currency: KnownStableSymbol;
  acceptsCurrencies: KnownStableSymbol[];
  response: PaymentLinkResponse;
  webhookUrl: string | null;
  wrapReceipt: boolean;
  metadata: Record<string, unknown>;
  disabled: boolean;
  protocol: PaymentLinkProtocol;
}>;

export async function updatePaymentLink(
  db: DbClient,
  args: { network: SvmNetwork; apiKeyId: string; id: string; patch: UpdatePaymentLinkPatch },
): Promise<PaymentLinkRow | null> {
  // Build a dynamic UPDATE so patches stay sparse — callers only send
  // the keys they want to change. Updating `disabled` toggles
  // `disabled_at` (ts on disable, NULL on re-enable) so the index keeps
  // its meaning.
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  const p = args.patch;
  if (p.label !== undefined) {
    sets.push('label = ?');
    values.push(p.label);
  }
  if (p.description !== undefined) {
    sets.push('description = ?');
    values.push(p.description);
  }
  if (p.price !== undefined) {
    sets.push('price = ?');
    values.push(p.price);
  }
  if (p.currency !== undefined) {
    sets.push('currency = ?');
    values.push(p.currency);
  }
  if (p.acceptsCurrencies !== undefined) {
    sets.push('accepts_currencies_json = ?');
    values.push(JSON.stringify(p.acceptsCurrencies));
  }
  if (p.response !== undefined) {
    sets.push('response_json = ?');
    values.push(JSON.stringify(p.response));
  }
  if (p.webhookUrl !== undefined) {
    sets.push('webhook_url = ?');
    values.push(p.webhookUrl);
  }
  if (p.wrapReceipt !== undefined) {
    sets.push('wrap_receipt = ?');
    values.push(p.wrapReceipt ? 1 : 0);
  }
  if (p.metadata !== undefined) {
    sets.push('metadata_json = ?');
    values.push(JSON.stringify(p.metadata));
  }
  if (p.disabled !== undefined) {
    sets.push(
      p.disabled ? `disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')` : `disabled_at = NULL`,
    );
  }
  if (p.protocol !== undefined) {
    sets.push('payment_protocol = ?');
    values.push(normalizePaymentProtocol(p.protocol));
  }
  if (sets.length === 0) {
    // No-op patch: return the row unchanged so callers don't have to
    // special-case empty-object PATCH bodies.
    return getPaymentLinkScoped(db, args);
  }
  sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  const sql = `UPDATE payment_links
    SET ${sets.join(', ')}
    WHERE network = ? AND api_key_id = ? AND id = ?`;
  values.push(args.network, args.apiKeyId, args.id);
  const res = await execute(db, sql, values);
  if (res.rowsAffected === 0) return null;
  return getPaymentLinkScoped(db, args);
}

export async function deletePaymentLink(
  db: DbClient,
  args: { network: SvmNetwork; apiKeyId: string; id: string },
): Promise<boolean> {
  const res = await execute(
    db,
    `DELETE FROM payment_links WHERE network = ? AND api_key_id = ? AND id = ?`,
    [args.network, args.apiKeyId, args.id],
  );
  return res.rowsAffected > 0;
}

/**
 * Bump `call_count` + stamp `last_called_at`. Called on every paywall
 * request, regardless of whether settlement succeeded — so call_count
 * always >= settled_count.
 */
export async function recordCall(
  db: DbClient,
  args: { network: SvmNetwork; id: string },
): Promise<void> {
  await execute(
    db,
    `UPDATE payment_links
       SET call_count = call_count + 1, last_called_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE network = ? AND id = ?`,
    [args.network, args.id],
  );
}

/**
 * Bump `settled_count` + stamp settlement metadata. Called from the
 * paywall's `onAfterSettle` hook so the most-recent settlement (tx
 * sig, amount, currency) is always queryable without joining receipts.
 */
export async function recordSettlement(
  db: DbClient,
  args: {
    network: SvmNetwork;
    id: string;
    txSig: string | null;
    amountAtomic: string | null;
    currency: string | null;
  },
): Promise<void> {
  await execute(
    db,
    `UPDATE payment_links
       SET settled_count = settled_count + 1,
           last_settled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           last_tx_sig = ?,
           last_settled_amount_atomic = ?,
           last_settled_currency = ?
       WHERE network = ? AND id = ?`,
    [args.txSig, args.amountAtomic, args.currency, args.network, args.id],
  );
}

function rowToPaymentLink(row: Record<string, unknown>): PaymentLinkRow {
  const network = String(row.network);
  if (network !== 'solana-devnet' && network !== 'solana-mainnet') {
    throw new Error(`unexpected network in payment_links: ${network}`);
  }
  const method = String(row.method);
  if (method !== 'GET' && method !== 'POST') {
    throw new Error(`unexpected method in payment_links: ${method}`);
  }
  let acceptsCurrencies: KnownStableSymbol[] = [];
  try {
    const parsed = JSON.parse(String(row.accepts_currencies_json ?? '[]'));
    if (Array.isArray(parsed)) {
      acceptsCurrencies = parsed.filter(isStable);
    }
  } catch {
    acceptsCurrencies = [];
  }
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(String(row.metadata_json ?? '{}'));
  } catch {
    metadata = {};
  }
  let response: PaymentLinkResponse;
  try {
    const parsed = JSON.parse(String(row.response_json));
    response = {
      status: Number(parsed.status) || 200,
      mimeType: String(parsed.mimeType ?? 'application/json'),
      body: parsed.body,
    };
  } catch {
    // Defensive: every row should have valid JSON, but we never want a
    // single corrupt record to take down the list endpoint.
    response = { status: 200, mimeType: 'application/json', body: {} };
  }
  const currency = String(row.currency);
  if (!isStable(currency)) {
    throw new Error(`unexpected currency in payment_links: ${currency}`);
  }
  return {
    id: String(row.id),
    network,
    apiKeyId: String(row.api_key_id),
    label: String(row.label),
    description: row.description != null ? String(row.description) : null,
    ownerAgent: String(row.owner_agent),
    ownerWallet: row.owner_wallet != null ? String(row.owner_wallet) : null,
    method,
    path: String(row.path),
    price: String(row.price),
    currency,
    acceptsCurrencies,
    response,
    webhookUrl: row.webhook_url != null ? String(row.webhook_url) : null,
    wrapReceipt: Number(row.wrap_receipt ?? 0) === 1,
    metadata,
    protocol: normalizePaymentProtocol(
      row.payment_protocol != null ? String(row.payment_protocol) : 'x402',
    ),
    callCount: Number(row.call_count ?? 0),
    settledCount: Number(row.settled_count ?? 0),
    lastCalledAt: row.last_called_at != null ? String(row.last_called_at) : null,
    lastSettledAt: row.last_settled_at != null ? String(row.last_settled_at) : null,
    lastTxSig: row.last_tx_sig != null ? String(row.last_tx_sig) : null,
    lastSettledAmountAtomic:
      row.last_settled_amount_atomic != null ? String(row.last_settled_amount_atomic) : null,
    lastSettledCurrency:
      row.last_settled_currency != null ? String(row.last_settled_currency) : null,
    disabledAt: row.disabled_at != null ? String(row.disabled_at) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function isStable(s: unknown): s is KnownStableSymbol {
  return s === 'USDC' || s === 'USDT' || s === 'USDG';
}

function normalizePaymentProtocol(raw: string | undefined): PaymentLinkProtocol {
  if (raw == null || raw.trim() === '') return 'x402';
  const s = raw.trim().toLowerCase();
  if (s === 'mpp') return 'mpp';
  return 'x402';
}
