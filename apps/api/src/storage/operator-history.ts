import type { EventKind, EventPhase, EventRow } from './events.js';
import type { DbClient } from './turso.js';
import { execute } from './turso.js';
import type { SvmNetwork } from '../util/network.js';

export type OperatorHistoryKind =
  | 'executive_register'
  | 'executive_delegate'
  | 'delegation_set'
  | 'delegation_revoke';

export type OperatorHistoryRow = {
  eventId: string;
  agentMint: string;
  network: SvmNetwork;
  kind: OperatorHistoryKind;
  phase: EventPhase;
  actor: string | null;
  delegate: string | null;
  executive: string | null;
  tokenMint: string | null;
  sourceTokenAccount: string | null;
  delegatedAmount: string | null;
  signature: string | null;
  eventSource: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  confirmedAt: string | null;
  failedAt: string | null;
};

const OPERATOR_EVENT_KINDS = new Set<EventKind>([
  'agent.executive.register',
  'agent.executive.delegate',
  'agent.delegation.set',
  'agent.delegation.revoke',
]);

function historyKind(kind: EventKind): OperatorHistoryKind | null {
  switch (kind) {
    case 'agent.executive.register':
      return 'executive_register';
    case 'agent.executive.delegate':
      return 'executive_delegate';
    case 'agent.delegation.set':
      return 'delegation_set';
    case 'agent.delegation.revoke':
      return 'delegation_revoke';
    default:
      return null;
  }
}

function stringMeta(metadata: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  }
  return null;
}

function eventSource(metadata: Record<string, unknown>): string {
  const source = stringMeta(metadata, ['source']);
  return source ?? 'api';
}

function rowToHistory(row: Record<string, unknown>): OperatorHistoryRow {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.metadata_json ?? '{}'));
    metadata =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    metadata = {};
  }
  return {
    eventId: String(row.event_id),
    agentMint: String(row.agent_mint),
    network: String(row.network) as SvmNetwork,
    kind: String(row.kind) as OperatorHistoryKind,
    phase: String(row.phase) as EventPhase,
    actor: row.actor == null ? null : String(row.actor),
    delegate: row.delegate == null ? null : String(row.delegate),
    executive: row.executive == null ? null : String(row.executive),
    tokenMint: row.token_mint == null ? null : String(row.token_mint),
    sourceTokenAccount: row.source_token_account == null ? null : String(row.source_token_account),
    delegatedAmount: row.delegated_amount == null ? null : String(row.delegated_amount),
    signature: row.signature == null ? null : String(row.signature),
    eventSource: String(row.event_source ?? 'api'),
    metadata,
    createdAt: String(row.created_at),
    confirmedAt: row.confirmed_at == null ? null : String(row.confirmed_at),
    failedAt: row.failed_at == null ? null : String(row.failed_at),
  };
}

export async function upsertOperatorHistoryFromEvent(db: DbClient, event: EventRow): Promise<void> {
  if (!event.agentAsset || !OPERATOR_EVENT_KINDS.has(event.kind)) return;
  const kind = historyKind(event.kind);
  if (!kind) return;

  const metadata = event.metadata ?? {};
  const actor =
    stringMeta(metadata, ['actor', 'authority', 'payer', 'owner_wallet']) ??
    (event.apiKeyId ? `api_key:${event.apiKeyId}` : null);
  const delegate = stringMeta(metadata, ['delegate', 'delegate_record']);
  const executive = stringMeta(metadata, [
    'executive',
    'executive_authority',
    'executive_profile',
    'profile',
  ]);
  const sourceTokenAccount = stringMeta(metadata, ['source_token_account']);
  const delegatedAmount =
    event.amountAtomic ?? stringMeta(metadata, ['delegated_amount', 'amount_atomic']);

  await execute(
    db,
    `INSERT INTO agent_operator_history (
      event_id, agent_mint, network, kind, phase, actor, delegate, executive,
      token_mint, source_token_account, delegated_amount, signature, event_source,
      metadata_json, created_at, confirmed_at, failed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(event_id) DO UPDATE SET
      phase = excluded.phase,
      actor = excluded.actor,
      delegate = excluded.delegate,
      executive = excluded.executive,
      token_mint = excluded.token_mint,
      source_token_account = excluded.source_token_account,
      delegated_amount = excluded.delegated_amount,
      signature = excluded.signature,
      event_source = excluded.event_source,
      metadata_json = excluded.metadata_json,
      confirmed_at = excluded.confirmed_at,
      failed_at = excluded.failed_at,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    [
      event.id,
      event.agentAsset,
      event.network,
      kind,
      event.phase,
      actor,
      delegate,
      executive,
      event.mint,
      sourceTokenAccount,
      delegatedAmount,
      event.signature,
      eventSource(metadata),
      JSON.stringify(metadata),
      event.ts,
      event.confirmedAt,
      event.failedAt,
    ],
  );
}

function eventRowFromDb(row: Record<string, unknown>): EventRow {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.metadata_json ?? '{}'));
    metadata =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    metadata = {};
  }
  return {
    id: String(row.id),
    ts: String(row.ts),
    kind: String(row.kind) as EventKind,
    phase: String(row.phase) as EventPhase,
    network: String(row.network) as SvmNetwork,
    apiKeyId: row.api_key_id == null ? null : String(row.api_key_id),
    clientReference: row.client_reference == null ? null : String(row.client_reference),
    agentAsset: row.agent_asset == null ? null : String(row.agent_asset),
    signature: row.signature == null ? null : String(row.signature),
    mint: row.mint == null ? null : String(row.mint),
    amountAtomic: row.amount_atomic == null ? null : String(row.amount_atomic),
    metadata,
    errorCode: row.error_code == null ? null : String(row.error_code),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    confirmedAt: row.confirmed_at == null ? null : String(row.confirmed_at),
    failedAt: row.failed_at == null ? null : String(row.failed_at),
  };
}

export async function syncOperatorHistoryFromEvents(
  db: DbClient,
  agentMint: string,
): Promise<void> {
  const placeholders = Array.from(OPERATOR_EVENT_KINDS)
    .map(() => '?')
    .join(',');
  const res = await execute(
    db,
    `SELECT * FROM events WHERE agent_asset = ? AND kind IN (${placeholders}) ORDER BY ts ASC`,
    [agentMint, ...Array.from(OPERATOR_EVENT_KINDS)],
  );
  for (const row of res.rows) {
    await upsertOperatorHistoryFromEvent(db, eventRowFromDb(row as Record<string, unknown>));
  }
}

export async function listOperatorHistory(
  db: DbClient,
  agentMint: string,
  opts: { publicOnly?: boolean; limit?: number } = {},
): Promise<OperatorHistoryRow[]> {
  await syncOperatorHistoryFromEvents(db, agentMint);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const filters = ['agent_mint = ?'];
  const args: string[] = [agentMint];
  if (opts.publicOnly) {
    filters.push(`phase = 'confirmed'`);
  }
  const res = await execute(
    db,
    `SELECT * FROM agent_operator_history
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC, event_id DESC
     LIMIT ${limit}`,
    args,
  );
  return res.rows.map((row) => rowToHistory(row as Record<string, unknown>));
}
