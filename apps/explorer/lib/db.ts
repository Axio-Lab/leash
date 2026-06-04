/**
 * Direct database access for the explorer.
 *
 * The explorer is the fourth process inside the Leash infra boundary
 * (api, indexer, webhook worker, explorer). It reads the same Turso /
 * libsql database the API and indexer write to — no HTTP hop, no API
 * key — and shapes rows into the snake_case wire types the views
 * already consume.
 *
 * On first use we call `@leashmarket/api`'s `runMigrations` against this
 * client (same CREATE TABLE IF NOT EXISTS as the API bootstrap), so a
 * brand-new `file:…` path gets an empty but valid schema instead of
 * "no such table: events".
 *
 * Configure with these env vars (shared with the API / indexer):
 *
 *   LEASH_DB_URL          libsql:// URL (or `file:./.leash-api.db` for
 *                         a local SQLite, mirroring the API default)
 *   LEASH_DB_AUTH_TOKEN   only for hosted Turso
 *
 * For backwards compatibility we also accept `LEASH_API_DB_URL` /
 * `LEASH_API_DB_AUTH_TOKEN`, which is what the API process itself
 * already reads — that lets devs point both processes at the same DB
 * with one env file.
 */

import { createClient, type Client } from '@libsql/client';
import { createHash } from 'node:crypto';
import {
  getEventById as apiGetEventById,
  getIndexerStatus as apiGetIndexerStatus,
  getNativeSubscription as apiGetNativeSubscription,
  getNativeSubscriptionPlan as apiGetNativeSubscriptionPlan,
  getReceiptByHash as apiGetReceiptByHash,
  listNativeSubscriptionEvents as apiListNativeSubscriptionEvents,
  listRecentReceipts as apiListRecentReceipts,
  listEvents as apiListEvents,
  listEventsForSignature as apiListEventsForSignature,
  listOperatorHistory as apiListOperatorHistory,
  listReceipts as apiListReceipts,
  runMigrations,
  type EventKind,
  type EventRow as ApiEventRow,
  type ReceiptRow as ApiReceiptRow,
} from '@leashmarket/api';

import type { Network } from './network';
import { networkToSlug } from './network';
import type {
  EventPage,
  IdentityDisclosureRead,
  EventRow,
  IndexerStatus,
  NativeSubscription,
  NativeSubscriptionPlan,
  PublicIdentityProfile,
  ReceiptPage,
  ReceiptRow,
} from './types';

let cached: Client | null = null;
/** First-connection schema (same SQL as the API bootstrap). Idempotent. */
let schemaPromise: Promise<void> | null = null;

function dbUrl(): string {
  return process.env.LEASH_DB_URL || process.env.LEASH_API_DB_URL || 'file:./.leash-api.db';
}

function dbAuthToken(): string | undefined {
  return process.env.LEASH_DB_AUTH_TOKEN || process.env.LEASH_API_DB_AUTH_TOKEN;
}

export function getDb(): Client {
  if (cached != null) return cached;
  const url = dbUrl();
  const token = dbAuthToken();
  cached = createClient({ url, ...(token ? { authToken: token } : {}) });
  return cached;
}

/** Test-only: drop the singleton so each test gets a fresh client. */
export function _resetDbForTests(): void {
  cached = null;
  schemaPromise = null;
}

async function ensureSchema(db: Client): Promise<void> {
  if (schemaPromise == null) {
    schemaPromise = runMigrations(db).catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  await schemaPromise;
}

export class DbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DbUnavailableError';
  }
}

async function withDb<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = getDb();
  try {
    await ensureSchema(db);
    return await fn(db);
  } catch (err) {
    throw new DbUnavailableError(`Leash DB unreachable (${dbUrl()}): ${(err as Error).message}`);
  }
}

// --- mapping helpers ------------------------------------------------

function eventToRow(row: ApiEventRow): EventRow {
  return {
    id: row.id,
    ts: row.ts,
    kind: row.kind,
    phase: row.phase,
    network: row.network,
    client_reference: row.clientReference,
    agent_asset: row.agentAsset,
    signature: row.signature,
    mint: row.mint,
    amount_atomic: row.amountAtomic,
    metadata: row.metadata,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    confirmed_at: row.confirmedAt,
    failed_at: row.failedAt,
  };
}

function receiptToRow(row: ApiReceiptRow): ReceiptRow {
  // Wrapper row carries ingested_at + receipt_hash for cursoring; views render
  // the typed receipt in `raw` (v0.1 or v0.2 dual-protocol).
  return row.raw;
}

function nativePlanToRow(
  row: NonNullable<Awaited<ReturnType<typeof apiGetNativeSubscriptionPlan>>>,
): NativeSubscriptionPlan {
  return {
    network: row.network,
    plan: row.plan,
    agent_mint: row.agentMint,
    merchant_wallet: row.merchantWallet,
    plan_id: row.planId,
    mint: row.mint,
    token_program: row.tokenProgram,
    symbol: row.symbol,
    amount_atomic: row.amountAtomic,
    period_hours: row.periodHours,
    status: row.status,
    metadata_uri: row.metadataUri,
    metadata: row.metadata,
    create_tx_sig: row.createTxSig,
    update_tx_sig: row.updateTxSig,
    last_event_id: row.lastEventId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function nativeSubscriptionToRow(
  row: NonNullable<Awaited<ReturnType<typeof apiGetNativeSubscription>>>,
): NativeSubscription {
  return {
    network: row.network,
    subscription: row.subscription,
    plan: row.plan,
    agent_mint: row.agentMint,
    subscriber_wallet: row.subscriberWallet,
    mint: row.mint,
    status: row.status,
    subscribe_tx_sig: row.subscribeTxSig,
    last_tx_sig: row.lastTxSig,
    last_event_id: row.lastEventId,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function parseJsonArray<T>(value: unknown): T[] {
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function disclosureTokenHash(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function redactDisclosureReceipt(
  receipt: Record<string, unknown>,
  fields: string[] | undefined,
): Record<string, unknown> {
  const selected = new Set(fields && fields.length > 0 ? fields : ['summary']);
  const out: Record<string, unknown> = {
    receipt_hash: receipt.receipt_hash,
    kind: receipt.kind,
    decision: receipt.decision,
    ts: receipt.ts,
  };
  if (selected.has('request')) out.request = receipt.request;
  if (selected.has('price')) out.price = receipt.price;
  if (selected.has('response')) out.response = receipt.response;
  if (selected.has('tx')) {
    out.tx_sig = receipt.tx_sig;
    out.mpp_settlement_tx = receipt.mpp_settlement_tx;
  }
  return out;
}

// --- page-facing reads ----------------------------------------------

export type ListEventsOptions = {
  network: Network;
  kind?: string;
  agent?: string;
  cursor?: string;
  limit?: number;
};

export async function listEvents(opts: ListEventsOptions): Promise<EventPage> {
  const limit = opts.limit ?? 15;
  const items = await withDb((db) =>
    apiListEvents(db, {
      network: networkToSlug(opts.network),
      ...(opts.kind ? { kind: opts.kind as EventKind } : {}),
      ...(opts.agent ? { agent: opts.agent } : {}),
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      limit,
    }),
  );
  const next_cursor =
    items.length > 0 && items.length === limit ? items[items.length - 1]!.id : null;
  return { items: items.map(eventToRow), next_cursor };
}

export async function getEventById(network: Network, id: string): Promise<EventRow | null> {
  const row = await withDb((db) => apiGetEventById(db, id));
  if (!row) return null;
  if (row.network !== networkToSlug(network)) return null;
  return eventToRow(row);
}

export async function getPublicIdentityProfile(
  network: Network,
  mint: string,
): Promise<PublicIdentityProfile | null> {
  const slug = networkToSlug(network);
  return withDb(async (db) => {
    const agent = await db.execute({
      sql: `SELECT mint, network, name, description, image_url, treasury, services
              FROM agents
             WHERE mint = ? AND network = ? AND status = 'active'
             LIMIT 1`,
      args: [mint, slug],
    });
    const agentRow = agent.rows[0] as Record<string, unknown> | undefined;
    if (!agentRow) return null;

    const profile = await db.execute({
      sql: `SELECT handle, capability_cards
              FROM agent_identity_profiles
             WHERE agent_mint = ?
             LIMIT 1`,
      args: [mint],
    });
    const profileRow = profile.rows[0] as Record<string, unknown> | undefined;

    const domains = await db.execute({
      sql: `SELECT domain
              FROM agent_identity_domains
             WHERE agent_mint = ? AND status = 'verified'
             ORDER BY created_at ASC`,
      args: [mint],
    });

    const claims = await db.execute({
      sql: `SELECT id, issuer, subject_mint, type, value, evidence_url, signature, visibility,
                   expires_at, revoked_at, created_at
              FROM agent_identity_claims
             WHERE agent_mint = ?
               AND visibility = 'public'
               AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
             ORDER BY created_at DESC`,
      args: [mint],
    });

    const receipts = await db.execute({
      sql: `SELECT decision FROM receipts WHERE network = ? AND agent = ?`,
      args: [slug, mint],
    });
    let settled = 0;
    let denied = 0;
    for (const row of receipts.rows) {
      if (String(row.decision) === 'allow') settled += 1;
      else denied += 1;
    }
    const total = settled + denied;
    const disputeRate = total === 0 ? 0 : denied / total;
    const weight = Math.min(1, Math.log10(settled + 1) / 3);

    const cards = parseJsonArray<PublicIdentityProfile['capability_cards'][number]>(
      profileRow?.capability_cards,
    ).filter((card) => card.visibility === 'public');
    const operatorHistory = await apiListOperatorHistory(db, mint, { publicOnly: true });

    return {
      mint: String(agentRow.mint),
      network: slug,
      handle: profileRow?.handle == null ? null : String(profileRow.handle),
      name: String(agentRow.name),
      description: agentRow.description == null ? null : String(agentRow.description),
      image_url: agentRow.image_url == null ? null : String(agentRow.image_url),
      treasury: String(agentRow.treasury),
      services: parseJsonArray<PublicIdentityProfile['services'][number]>(agentRow.services),
      verified_domains: domains.rows.map((row) => String(row.domain)),
      capability_cards: cards,
      claims: claims.rows.map((row) => ({
        id: String(row.id),
        issuer: String(row.issuer),
        subject_mint: String(row.subject_mint),
        type: String(row.type),
        value: String(row.value),
        evidence_url: row.evidence_url == null ? null : String(row.evidence_url),
        signature: String(row.signature),
        visibility: String(row.visibility) as 'public' | 'private',
        expires_at: row.expires_at == null ? null : String(row.expires_at),
        revoked_at: row.revoked_at == null ? null : String(row.revoked_at),
        created_at: String(row.created_at),
      })),
      operator_history: operatorHistory.map((row) => ({
        event_id: row.eventId,
        kind: row.kind,
        phase: row.phase,
        actor: row.actor?.startsWith('api_key:') ? null : row.actor,
        delegate: row.delegate,
        executive: row.executive,
        token_mint: row.tokenMint,
        source_token_account: row.sourceTokenAccount,
        delegated_amount: row.delegatedAmount,
        signature: row.signature,
        event_source: row.eventSource,
        created_at: row.createdAt,
        confirmed_at: row.confirmedAt,
        failed_at: row.failedAt,
      })),
      reputation: {
        settled_calls: settled,
        denied_calls: denied,
        rating: Number(((1 - disputeRate) * weight).toFixed(4)),
      },
    };
  });
}

export async function resolveAgentMintByHandle(
  network: Network,
  handle: string,
): Promise<string | null> {
  const slug = networkToSlug(network);
  return withDb(async (db) => {
    const res = await db.execute({
      sql: `SELECT a.mint
              FROM agent_identity_profiles p
              JOIN agents a
                ON a.mint = p.agent_mint
               AND a.network = p.network
             WHERE p.handle = ?
               AND p.network = ?
               AND a.status = 'active'
             LIMIT 1`,
      args: [handle, slug],
    });
    const row = res.rows[0] as Record<string, unknown> | undefined;
    return row?.mint == null ? null : String(row.mint);
  });
}

export async function getIdentityDisclosureByToken(
  token: string,
): Promise<IdentityDisclosureRead | null> {
  return withDb(async (db) => {
    const grantRes = await db.execute({
      sql: `SELECT * FROM agent_identity_disclosures WHERE token_hash = ? LIMIT 1`,
      args: [disclosureTokenHash(token)],
    });
    const grant = grantRes.rows[0] as Record<string, unknown> | undefined;
    if (!grant || grant.revoked_at != null) return null;
    if (Date.parse(String(grant.expires_at)) <= Date.now()) return null;

    const agentMint = String(grant.agent_mint);
    const network = String(grant.network) as IdentityDisclosureRead['agent']['network'];
    const resources = parseJsonArray<
      | { kind: 'capability_card'; id: string }
      | { kind: 'claim'; id: string }
      | { kind: 'receipt'; receipt_hash: string; fields?: string[] }
    >(grant.resources_json);

    const agentRes = await db.execute({
      sql: `SELECT mint, network, name
              FROM agents
             WHERE mint = ? AND network = ? AND status = 'active'
             LIMIT 1`,
      args: [agentMint, network],
    });
    const agent = agentRes.rows[0] as Record<string, unknown> | undefined;
    if (!agent) return null;

    const profileRes = await db.execute({
      sql: `SELECT handle, capability_cards
              FROM agent_identity_profiles
             WHERE agent_mint = ?
             LIMIT 1`,
      args: [agentMint],
    });
    const profile = profileRes.rows[0] as Record<string, unknown> | undefined;
    const cards = parseJsonArray<IdentityDisclosureRead['resources']['capability_cards'][number]>(
      profile?.capability_cards,
    );

    const claimRes = await db.execute({
      sql: `SELECT id, issuer, subject_mint, type, value, evidence_url, signature, visibility,
                   expires_at, revoked_at, created_at
              FROM agent_identity_claims
             WHERE agent_mint = ?`,
      args: [agentMint],
    });

    const cardIds = new Set(
      resources
        .filter((resource) => resource.kind === 'capability_card')
        .map((resource) => resource.id),
    );
    const claimIds = new Set(
      resources.filter((resource) => resource.kind === 'claim').map((resource) => resource.id),
    );
    const now = Date.now();
    const receipts: Record<string, unknown>[] = [];
    for (const resource of resources.filter((item) => item.kind === 'receipt')) {
      const receiptRes = await db.execute({
        sql: `SELECT raw_json FROM receipts
               WHERE network = ? AND agent = ? AND receipt_hash = ?
               LIMIT 1`,
        args: [network, agentMint, resource.receipt_hash],
      });
      const receiptRow = receiptRes.rows[0] as Record<string, unknown> | undefined;
      if (!receiptRow) continue;
      receipts.push(redactDisclosureReceipt(parseJsonObject(receiptRow.raw_json), resource.fields));
    }

    return {
      id: String(grant.id),
      agent: {
        mint: agentMint,
        network,
        handle: profile?.handle == null ? null : String(profile.handle),
        name: String(agent.name),
      },
      expires_at: String(grant.expires_at),
      resources: {
        capability_cards: cards.filter((card) => cardIds.has(card.id)),
        claims: claimRes.rows
          .map((row) => row as Record<string, unknown>)
          .filter((row) => {
            if (!claimIds.has(String(row.id)) || row.revoked_at != null) return false;
            if (row.expires_at != null && Date.parse(String(row.expires_at)) <= now) return false;
            return true;
          })
          .map((row) => ({
            id: String(row.id),
            issuer: String(row.issuer),
            subject_mint: String(row.subject_mint),
            type: String(row.type),
            value: String(row.value),
            evidence_url: row.evidence_url == null ? null : String(row.evidence_url),
            signature: String(row.signature),
            visibility: String(row.visibility) as 'public' | 'private',
            expires_at: row.expires_at == null ? null : String(row.expires_at),
            revoked_at: row.revoked_at == null ? null : String(row.revoked_at),
            created_at: String(row.created_at),
          })),
        receipts,
      },
    };
  });
}

export async function listEventsForSignature(
  network: Network,
  signature: string,
): Promise<EventRow[]> {
  const rows = await withDb((db) =>
    apiListEventsForSignature(db, networkToSlug(network), signature),
  );
  return rows.map(eventToRow);
}

export async function getNativeSubscriptionPlan(
  network: Network,
  plan: string,
): Promise<NativeSubscriptionPlan | null> {
  const row = await withDb((db) => apiGetNativeSubscriptionPlan(db, networkToSlug(network), plan));
  return row ? nativePlanToRow(row) : null;
}

export async function getNativeSubscription(
  network: Network,
  subscription: string,
): Promise<NativeSubscription | null> {
  const row = await withDb((db) =>
    apiGetNativeSubscription(db, networkToSlug(network), subscription),
  );
  return row ? nativeSubscriptionToRow(row) : null;
}

export async function listNativeSubscriptionEvents(opts: {
  network: Network;
  plan?: string;
  subscription?: string;
  limit?: number;
}): Promise<EventRow[]> {
  const rows = await withDb((db) =>
    apiListNativeSubscriptionEvents(db, {
      network: networkToSlug(opts.network),
      ...(opts.plan ? { plan: opts.plan } : {}),
      ...(opts.subscription ? { subscription: opts.subscription } : {}),
      ...(opts.limit ? { limit: opts.limit } : {}),
    }),
  );
  return rows.map(eventToRow);
}

export async function listReceipts(opts: {
  network: Network;
  agent: string;
  cursor?: string;
  limit?: number;
  kind?: 'spend' | 'earn';
}): Promise<ReceiptPage> {
  const limit = opts.limit ?? 25;
  const rows = await withDb((db) =>
    apiListReceipts(db, {
      network: networkToSlug(opts.network),
      agent: opts.agent,
      cursor: opts.cursor ?? null,
      kind: opts.kind ?? null,
      limit,
    }),
  );
  const last = rows[rows.length - 1];
  const next_cursor =
    last && rows.length === limit ? `${last.ingestedAt}|${last.receiptHash}` : null;
  return { items: rows.map(receiptToRow), next_cursor };
}

export async function getReceiptByHash(network: Network, hash: string): Promise<ReceiptRow | null> {
  const row = await withDb((db) => apiGetReceiptByHash(db, networkToSlug(network), hash));
  if (!row) return null;
  return receiptToRow(row);
}

/**
 * Cross-agent recent-receipts feed for the homepage panel and the
 * `/receipts` page. Reads straight from the receipts table so we
 * don't depend on event metadata having `receipt_hash` populated
 * (older rows didn't).
 */
export async function listRecentReceipts(opts: {
  network: Network;
  limit?: number;
  cursor?: string;
  kind?: 'spend' | 'earn';
}): Promise<ReceiptPage> {
  const limit = opts.limit ?? 15;
  const rows = await withDb((db) =>
    apiListRecentReceipts(db, networkToSlug(opts.network), {
      limit,
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
      ...(opts.kind ? { kind: opts.kind } : {}),
    }),
  );
  // Pull cursor metadata off the underlying ApiReceiptRow, before we
  // strip it down to the inner receipt in receiptToRow.
  const last = rows[rows.length - 1];
  const next_cursor =
    last && rows.length === limit ? `${last.ingestedAt}|${last.receiptHash}` : null;
  return { items: rows.map(receiptToRow), next_cursor };
}

export async function getIndexerStatus(network: Network): Promise<IndexerStatus> {
  return withDb((db) => apiGetIndexerStatus(db, networkToSlug(network)));
}

/**
 * Summary of all `protocol.fee.collected` events on a network, grouped
 * by mint. Powers the explorer's "Protocol fees" panel — total revenue
 * per stablecoin since the rollout, plus a count of settled calls.
 *
 * We sum from the events table (not the receipts table) because the
 * receipt-side ingest is best-effort and the chain-side detection
 * (decoder + watchlist) covers the gap; together they're the authoritative
 * source of truth for protocol revenue.
 */
export type ProtocolFeeMintTotal = {
  mint: string | null;
  currency: string | null;
  totalAtomic: string;
  count: number;
};

export async function listProtocolFeeTotals(network: Network): Promise<ProtocolFeeMintTotal[]> {
  const rows = await withDb(async (db) => {
    // We sum amount_atomic as integers via SUM(CAST(... AS INTEGER));
    // SQLite handles bigint up to ~2^63 which is plenty for stablecoin
    // revenue (1B USDC = 1e15 atoms = ~2^50). Currency comes from the
    // metadata blob — newer rows always carry it; older / chain-side
    // rows may be null, so we coalesce to JSON-extract the field.
    const sql = `SELECT mint,
                        json_extract(metadata_json, '$.currency') AS currency,
                        COALESCE(SUM(CAST(amount_atomic AS INTEGER)), 0) AS total_atomic,
                        COUNT(*) AS n
                   FROM events
                  WHERE network = ?
                    AND kind = 'protocol.fee.collected'
                  GROUP BY mint, currency
                  ORDER BY total_atomic DESC`;
    const res = await db.execute({ sql, args: [networkToSlug(network)] });
    return res.rows;
  });
  return rows.map((r) => ({
    mint: r.mint != null ? String(r.mint) : null,
    currency: r.currency != null ? String(r.currency) : null,
    totalAtomic: String(r.total_atomic ?? '0'),
    count: Number(r.n ?? 0),
  }));
}

/**
 * All-time stablecoin settlement totals for a network.
 *
 * Sums `price.amount` and `price.fee` from every `earn` receipt
 * (so each x402 settlement counts once — every settlement creates
 * paired earn + spend receipts). Stables are USDC/USDG/USDT, all
 * 6-decimals 1:1-to-USD, so the SQL can sum atomic ints and the
 * caller divides by 1e6 to get USD without per-mint arithmetic.
 *
 * The receipts table stores the canonical receipt JSON (`ReceiptAny`) as
 * `raw_json`, so we extract the relevant scalars via `json_extract`.
 * Receipts that lack a `price.amount` (rare — e.g. legacy denied
 * rows) are simply skipped via the `WHERE` clause.
 */
export type SettlementTotals = {
  /** USD-equivalent gross volume (sum of `price.amount`), human units. */
  gross_usd: number;
  /** USD-equivalent protocol fees collected (sum of `price.fee`). */
  fees_usd: number;
  /** Number of distinct earn receipts that contributed to the totals. */
  settled_count: number;
};

const STABLE_DECIMALS = 6;

export async function getSettlementTotals(network: Network): Promise<SettlementTotals> {
  const row = await withDb(async (db) => {
    const sql = `SELECT
        COALESCE(SUM(CAST(json_extract(raw_json, '$.price.amount') AS INTEGER)), 0) AS gross_atomic,
        COALESCE(SUM(CAST(json_extract(raw_json, '$.price.fee') AS INTEGER)), 0)    AS fee_atomic,
        COUNT(*) AS n
       FROM receipts
       WHERE network = ?
         AND kind = 'earn'
         AND json_extract(raw_json, '$.price.amount') IS NOT NULL`;
    const res = await db.execute({ sql, args: [networkToSlug(network)] });
    return res.rows[0] ?? null;
  });
  if (!row) return { gross_usd: 0, fees_usd: 0, settled_count: 0 };
  const grossAtomic = Number(row.gross_atomic ?? 0);
  const feeAtomic = Number(row.fee_atomic ?? 0);
  const divisor = 10 ** STABLE_DECIMALS;
  return {
    gross_usd: grossAtomic / divisor,
    fees_usd: feeAtomic / divisor,
    settled_count: Number(row.n ?? 0),
  };
}

/**
 * For each `tx_sig`, return the (payer, receiver) agent pair derived
 * from the receipts table — buyer-side `spend` receipts give us the
 * payer, seller-side `earn` receipts give us the receiver. When only
 * one side is present (no counterparty receipt has been ingested) the
 * other field is `null` so the UI can render "—".
 *
 * This is the explorer's per-row counterparty lookup: the receipts
 * panel calls it once per page load with the tx signatures it's about
 * to render, so the table can show "Payer ↔ Receiver" without
 * round-tripping the indexer for each row.
 */
export async function getCounterpartiesForTxs(
  network: Network,
  txSigs: ReadonlyArray<string>,
): Promise<Map<string, { payer: string | null; receiver: string | null }>> {
  const map = new Map<string, { payer: string | null; receiver: string | null }>();
  // Filter to non-empty unique sigs. Bail if there's nothing to ask.
  const sigs = Array.from(new Set(txSigs.filter((s): s is string => !!s && s.length > 0)));
  if (sigs.length === 0) return map;
  const placeholders = sigs.map(() => '?').join(',');
  const sql = `SELECT tx_sig, kind, agent FROM receipts
               WHERE network = ? AND tx_sig IN (${placeholders})`;
  const rows = await withDb(async (db) => {
    const res = await db.execute({ sql, args: [networkToSlug(network), ...sigs] });
    return res.rows;
  });
  for (const row of rows) {
    const sig = String(row.tx_sig ?? '');
    if (!sig) continue;
    const kind = String(row.kind ?? '');
    const agent = String(row.agent ?? '');
    const cur = map.get(sig) ?? { payer: null, receiver: null };
    if (kind === 'spend') cur.payer = agent;
    else if (kind === 'earn') cur.receiver = agent;
    map.set(sig, cur);
  }
  return map;
}
