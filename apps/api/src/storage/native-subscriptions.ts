/**
 * Native Solana subscription read model.
 *
 * The on-chain program stores compact billing terms plus a `metadata_uri`.
 * Leash hosts that metadata and mirrors the important plan/subscription
 * fields here so Explorer, MCP, and webhooks can resolve native subscription
 * objects without scanning all Solana program accounts.
 */

import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { EventRow } from './events.js';
import type { SvmNetwork } from '../util/network.js';

export type NativeSubscriptionPlanStatus = 'active' | 'sunset';
export type NativeSubscriptionStatus = 'active' | 'cancelled' | 'revoked';

export type NativeSubscriptionPlanMetadata = {
  type: 'leash.native_subscription_plan';
  version: '1.0';
  name: string;
  description?: string;
  price: {
    amount: string;
    amount_atomic: string;
    currency: string;
    mint: string;
    period_hours: number;
    period_label: string;
  };
  merchant_agent: string;
  merchant_wallet: string;
  plan: string;
  plan_id: string;
  network: SvmNetwork;
  terms_url?: string;
  support_url?: string;
  explorer_url?: string;
};

export type NativeSubscriptionPlanRow = {
  network: SvmNetwork;
  plan: string;
  agentMint: string;
  merchantWallet: string;
  planId: string;
  mint: string;
  tokenProgram: string;
  symbol: string | null;
  amountAtomic: string;
  periodHours: string;
  status: NativeSubscriptionPlanStatus;
  metadataUri: string;
  metadata: NativeSubscriptionPlanMetadata | Record<string, unknown>;
  createTxSig: string | null;
  updateTxSig: string | null;
  lastEventId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type NativeSubscriptionRow = {
  network: SvmNetwork;
  subscription: string;
  plan: string;
  agentMint: string;
  subscriberWallet: string;
  mint: string | null;
  status: NativeSubscriptionStatus;
  subscribeTxSig: string | null;
  lastTxSig: string | null;
  lastEventId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpsertNativeSubscriptionPlanInput = {
  network: SvmNetwork;
  plan: string;
  agentMint: string;
  merchantWallet: string;
  planId: string;
  mint: string;
  tokenProgram: string;
  symbol?: string | null;
  amountAtomic: string;
  periodHours: string;
  status?: NativeSubscriptionPlanStatus;
  metadataUri: string;
  metadata: NativeSubscriptionPlanMetadata | Record<string, unknown>;
  createTxSig?: string | null;
  updateTxSig?: string | null;
  lastEventId?: string | null;
};

export type UpsertNativeSubscriptionInput = {
  network: SvmNetwork;
  subscription: string;
  plan: string;
  agentMint: string;
  subscriberWallet: string;
  mint?: string | null;
  status?: NativeSubscriptionStatus;
  subscribeTxSig?: string | null;
  lastTxSig?: string | null;
  lastEventId?: string | null;
};

export function nativePlanMetadataUri(args: {
  apiOrigin: string;
  network: SvmNetwork;
  plan: string;
}): string {
  return `${args.apiOrigin.replace(/\/+$/, '')}/v1/subscription-plans/${encodeURIComponent(
    args.plan,
  )}/metadata?network=${encodeURIComponent(args.network)}`;
}

export function nativePlanExplorerUrl(args: {
  explorerOrigin: string;
  plan: string;
  network: SvmNetwork;
}): string {
  const cluster = args.network === 'solana-mainnet' ? 'mainnet' : 'devnet';
  return `${args.explorerOrigin.replace(/\/+$/, '')}/subscription-plan/${encodeURIComponent(
    args.plan,
  )}?network=${cluster}`;
}

export function buildNativePlanMetadata(args: {
  name?: string | null;
  description?: string | null;
  amount: string;
  amountAtomic: string;
  currency: string;
  mint: string;
  periodHours: string | number;
  merchantAgent: string;
  merchantWallet: string;
  plan: string;
  planId: string;
  network: SvmNetwork;
  termsUrl?: string | null;
  supportUrl?: string | null;
  explorerUrl?: string | null;
}): NativeSubscriptionPlanMetadata {
  const periodHours = Number(args.periodHours);
  const wholeDays =
    Number.isFinite(periodHours) && periodHours % 24 === 0 ? periodHours / 24 : null;
  const periodLabel =
    wholeDays != null
      ? `${wholeDays} ${wholeDays === 1 ? 'day' : 'days'}`
      : `${args.periodHours} hours`;
  return {
    type: 'leash.native_subscription_plan',
    version: '1.0',
    name: args.name?.trim() || `Native subscription plan ${args.planId}`,
    ...(args.description?.trim() ? { description: args.description.trim() } : {}),
    price: {
      amount: args.amount,
      amount_atomic: args.amountAtomic,
      currency: args.currency,
      mint: args.mint,
      period_hours: Number.isFinite(periodHours) ? periodHours : 0,
      period_label: periodLabel,
    },
    merchant_agent: args.merchantAgent,
    merchant_wallet: args.merchantWallet,
    plan: args.plan,
    plan_id: args.planId,
    network: args.network,
    ...(args.termsUrl?.trim() ? { terms_url: args.termsUrl.trim() } : {}),
    ...(args.supportUrl?.trim() ? { support_url: args.supportUrl.trim() } : {}),
    ...(args.explorerUrl?.trim() ? { explorer_url: args.explorerUrl.trim() } : {}),
  };
}

export async function upsertNativeSubscriptionPlan(
  db: DbClient,
  input: UpsertNativeSubscriptionPlanInput,
): Promise<NativeSubscriptionPlanRow> {
  await execute(
    db,
    `INSERT INTO native_subscription_plans (
       network, plan, agent_mint, merchant_wallet, plan_id, mint, token_program,
       symbol, amount_atomic, period_hours, status, metadata_uri, metadata_json,
       create_tx_sig, update_tx_sig, last_event_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(network, plan) DO UPDATE SET
       agent_mint = excluded.agent_mint,
       merchant_wallet = excluded.merchant_wallet,
       plan_id = excluded.plan_id,
       mint = excluded.mint,
       token_program = excluded.token_program,
       symbol = excluded.symbol,
       amount_atomic = excluded.amount_atomic,
       period_hours = excluded.period_hours,
       status = excluded.status,
       metadata_uri = excluded.metadata_uri,
       metadata_json = excluded.metadata_json,
       create_tx_sig = COALESCE(excluded.create_tx_sig, native_subscription_plans.create_tx_sig),
       update_tx_sig = COALESCE(excluded.update_tx_sig, native_subscription_plans.update_tx_sig),
       last_event_id = COALESCE(excluded.last_event_id, native_subscription_plans.last_event_id),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [
      input.network,
      input.plan,
      input.agentMint,
      input.merchantWallet,
      input.planId,
      input.mint,
      input.tokenProgram,
      input.symbol ?? null,
      input.amountAtomic,
      input.periodHours,
      input.status ?? 'active',
      input.metadataUri,
      JSON.stringify(input.metadata),
      input.createTxSig ?? null,
      input.updateTxSig ?? null,
      input.lastEventId ?? null,
    ],
  );
  const row = await getNativeSubscriptionPlan(db, input.network, input.plan);
  if (!row) throw new Error('native subscription plan upsert succeeded but lookup failed');
  return row;
}

export async function updateNativeSubscriptionPlanRecord(
  db: DbClient,
  input: {
    network: SvmNetwork;
    plan: string;
    status?: NativeSubscriptionPlanStatus | null;
    metadataUri?: string | null;
    metadata?: Record<string, unknown> | null;
    updateTxSig?: string | null;
    lastEventId?: string | null;
  },
): Promise<NativeSubscriptionPlanRow | null> {
  const existing = await getNativeSubscriptionPlan(db, input.network, input.plan);
  if (!existing) return null;
  await execute(
    db,
    `UPDATE native_subscription_plans
        SET status = ?,
            metadata_uri = ?,
            metadata_json = ?,
            update_tx_sig = COALESCE(?, update_tx_sig),
            last_event_id = COALESCE(?, last_event_id),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE network = ? AND plan = ?`,
    [
      input.status ?? existing.status,
      input.metadataUri ?? existing.metadataUri,
      JSON.stringify(input.metadata ?? existing.metadata),
      input.updateTxSig ?? null,
      input.lastEventId ?? null,
      input.network,
      input.plan,
    ],
  );
  return getNativeSubscriptionPlan(db, input.network, input.plan);
}

export async function getNativeSubscriptionPlan(
  db: DbClient,
  network: SvmNetwork,
  plan: string,
): Promise<NativeSubscriptionPlanRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM native_subscription_plans WHERE network = ? AND plan = ? LIMIT 1`,
    [network, plan],
  );
  const row = res.rows[0];
  return row ? rowToPlan(row) : null;
}

export async function upsertNativeSubscription(
  db: DbClient,
  input: UpsertNativeSubscriptionInput,
): Promise<NativeSubscriptionRow> {
  await execute(
    db,
    `INSERT INTO native_subscriptions (
       network, subscription, plan, agent_mint, subscriber_wallet, mint,
       status, subscribe_tx_sig, last_tx_sig, last_event_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(network, subscription) DO UPDATE SET
       plan = excluded.plan,
       agent_mint = excluded.agent_mint,
       subscriber_wallet = excluded.subscriber_wallet,
       mint = COALESCE(excluded.mint, native_subscriptions.mint),
       status = excluded.status,
       subscribe_tx_sig = COALESCE(excluded.subscribe_tx_sig, native_subscriptions.subscribe_tx_sig),
       last_tx_sig = COALESCE(excluded.last_tx_sig, native_subscriptions.last_tx_sig),
       last_event_id = COALESCE(excluded.last_event_id, native_subscriptions.last_event_id),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [
      input.network,
      input.subscription,
      input.plan,
      input.agentMint,
      input.subscriberWallet,
      input.mint ?? null,
      input.status ?? 'active',
      input.subscribeTxSig ?? null,
      input.lastTxSig ?? null,
      input.lastEventId ?? null,
    ],
  );
  const row = await getNativeSubscription(db, input.network, input.subscription);
  if (!row) throw new Error('native subscription upsert succeeded but lookup failed');
  return row;
}

export async function updateNativeSubscriptionStatus(
  db: DbClient,
  input: {
    network: SvmNetwork;
    subscription: string;
    status: NativeSubscriptionStatus;
    lastTxSig?: string | null;
    lastEventId?: string | null;
  },
): Promise<NativeSubscriptionRow | null> {
  await execute(
    db,
    `UPDATE native_subscriptions
        SET status = ?,
            last_tx_sig = COALESCE(?, last_tx_sig),
            last_event_id = COALESCE(?, last_event_id),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE network = ? AND subscription = ?`,
    [
      input.status,
      input.lastTxSig ?? null,
      input.lastEventId ?? null,
      input.network,
      input.subscription,
    ],
  );
  return getNativeSubscription(db, input.network, input.subscription);
}

export async function getNativeSubscription(
  db: DbClient,
  network: SvmNetwork,
  subscription: string,
): Promise<NativeSubscriptionRow | null> {
  const res = await execute(
    db,
    `SELECT * FROM native_subscriptions WHERE network = ? AND subscription = ? LIMIT 1`,
    [network, subscription],
  );
  const row = res.rows[0];
  return row ? rowToSubscription(row) : null;
}

export async function listNativeSubscriptionEvents(
  db: DbClient,
  args: { network: SvmNetwork; plan?: string; subscription?: string; limit?: number },
): Promise<EventRow[]> {
  const { rowToEvent } = await import('./events.js');
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const filters = ['network = ?'];
  const values: (string | number)[] = [args.network];
  if (args.plan) {
    filters.push(`json_extract(metadata_json, '$.plan') = ?`);
    values.push(args.plan);
  }
  if (args.subscription) {
    filters.push(`json_extract(metadata_json, '$.subscription') = ?`);
    values.push(args.subscription);
  }
  const res = await execute(
    db,
    `SELECT * FROM events
      WHERE ${filters.join(' AND ')}
      ORDER BY id DESC
      LIMIT ${limit}`,
    values,
  );
  return res.rows.map(rowToEvent);
}

function rowToPlan(row: Record<string, unknown>): NativeSubscriptionPlanRow {
  return {
    network: String(row.network) as SvmNetwork,
    plan: String(row.plan),
    agentMint: String(row.agent_mint),
    merchantWallet: String(row.merchant_wallet),
    planId: String(row.plan_id),
    mint: String(row.mint),
    tokenProgram: String(row.token_program),
    symbol: row.symbol == null ? null : String(row.symbol),
    amountAtomic: String(row.amount_atomic),
    periodHours: String(row.period_hours),
    status: String(row.status) as NativeSubscriptionPlanStatus,
    metadataUri: String(row.metadata_uri),
    metadata: parseObject(row.metadata_json),
    createTxSig: row.create_tx_sig == null ? null : String(row.create_tx_sig),
    updateTxSig: row.update_tx_sig == null ? null : String(row.update_tx_sig),
    lastEventId: row.last_event_id == null ? null : String(row.last_event_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToSubscription(row: Record<string, unknown>): NativeSubscriptionRow {
  return {
    network: String(row.network) as SvmNetwork,
    subscription: String(row.subscription),
    plan: String(row.plan),
    agentMint: String(row.agent_mint),
    subscriberWallet: String(row.subscriber_wallet),
    mint: row.mint == null ? null : String(row.mint),
    status: String(row.status) as NativeSubscriptionStatus,
    subscribeTxSig: row.subscribe_tx_sig == null ? null : String(row.subscribe_tx_sig),
    lastTxSig: row.last_tx_sig == null ? null : String(row.last_tx_sig),
    lastEventId: row.last_event_id == null ? null : String(row.last_event_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
