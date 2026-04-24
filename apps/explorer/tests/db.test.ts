/**
 * Wiring tests for `lib/db.ts`.
 *
 * The explorer is an internal infra tool — it talks straight to the
 * libsql database the API and indexer write to. These tests stub the
 * `@leash/api` storage helpers and verify our wrapper:
 *   - maps `Network` ('devnet'|'mainnet') to the canonical SVM slug
 *   - reshapes camelCase storage rows into the snake_case wire types
 *     the explorer's pages already render
 *   - paginates correctly (next_cursor only when the page is full)
 *   - turns connection failures into a `DbUnavailableError`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listEventsMock = vi.fn();
const getEventByIdMock = vi.fn();
const listEventsForSignatureMock = vi.fn();
const listReceiptsMock = vi.fn();
const getReceiptByHashMock = vi.fn();
const getIndexerStatusMock = vi.fn();

vi.mock('@leash/api', () => ({
  listEvents: listEventsMock,
  getEventById: getEventByIdMock,
  listEventsForSignature: listEventsForSignatureMock,
  listReceipts: listReceiptsMock,
  getReceiptByHash: getReceiptByHashMock,
  getIndexerStatus: getIndexerStatusMock,
}));

// libsql's `createClient` is invoked lazily on the first DB read; we
// stub it so the tests don't actually touch a SQLite file or libsql
// server.
vi.mock('@libsql/client', () => ({
  createClient: vi.fn(() => ({ execute: vi.fn() })),
}));

async function importDb() {
  // The module reads env eagerly only inside its functions, so a fresh
  // import + reset is enough between tests.
  const mod = await import('../lib/db');
  mod._resetDbForTests();
  return mod;
}

describe('listEvents', () => {
  beforeEach(() => {
    process.env.LEASH_DB_URL = 'file::memory:';
    listEventsMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('passes the canonical network slug and reshapes rows', async () => {
    listEventsMock.mockResolvedValueOnce([
      {
        id: 'EVENT-1',
        ts: '2025-01-01T00:00:00Z',
        kind: 'agent.identity.register',
        phase: 'confirmed',
        network: 'solana-devnet',
        apiKeyId: 'k1',
        clientReference: 'ref-a',
        agentAsset: 'AgentAsset',
        signature: 'Sig',
        mint: null,
        amountAtomic: null,
        metadata: { foo: 1 },
        errorCode: null,
        errorMessage: null,
        confirmedAt: '2025-01-01T00:00:01Z',
        failedAt: null,
      },
    ]);
    const { listEvents } = await importDb();
    const page = await listEvents({ network: 'devnet', limit: 50 });
    expect(listEventsMock).toHaveBeenCalledTimes(1);
    expect(listEventsMock.mock.calls[0]?.[1]).toMatchObject({
      network: 'solana-devnet',
      limit: 50,
    });
    expect(page.items[0]).toMatchObject({
      id: 'EVENT-1',
      kind: 'agent.identity.register',
      agent_asset: 'AgentAsset',
      client_reference: 'ref-a',
      confirmed_at: '2025-01-01T00:00:01Z',
    });
    // Page is not full (1 row, limit 50) — no cursor.
    expect(page.next_cursor).toBeNull();
  });

  it('emits a next_cursor when the page is full', async () => {
    listEventsMock.mockResolvedValueOnce(
      Array.from({ length: 2 }, (_, i) => ({
        id: `EVENT-${i}`,
        ts: '2025-01-01T00:00:00Z',
        kind: 'submit.raw',
        phase: 'confirmed',
        network: 'solana-mainnet',
        apiKeyId: null,
        clientReference: null,
        agentAsset: null,
        signature: 'sig',
        mint: null,
        amountAtomic: null,
        metadata: {},
        errorCode: null,
        errorMessage: null,
        confirmedAt: null,
        failedAt: null,
      })),
    );
    const { listEvents } = await importDb();
    const page = await listEvents({ network: 'mainnet', limit: 2 });
    expect(page.next_cursor).toBe('EVENT-1');
  });
});

describe('getEventById', () => {
  beforeEach(() => {
    process.env.LEASH_DB_URL = 'file::memory:';
    getEventByIdMock.mockReset();
  });

  it('returns null when the event lives on the other network', async () => {
    getEventByIdMock.mockResolvedValueOnce({
      id: 'X',
      ts: '2025-01-01T00:00:00Z',
      kind: 'submit.raw',
      phase: 'confirmed',
      network: 'solana-mainnet',
      apiKeyId: null,
      clientReference: null,
      agentAsset: null,
      signature: null,
      mint: null,
      amountAtomic: null,
      metadata: {},
      errorCode: null,
      errorMessage: null,
      confirmedAt: null,
      failedAt: null,
    });
    const { getEventById } = await importDb();
    const r = await getEventById('devnet', 'X');
    expect(r).toBeNull();
  });
});

describe('getReceiptByHash', () => {
  beforeEach(() => {
    process.env.LEASH_DB_URL = 'file::memory:';
    getReceiptByHashMock.mockReset();
  });

  it('returns the inner ReceiptV1 (not the wrapper)', async () => {
    const inner = {
      v: '0.1',
      kind: 'spend',
      decision: 'allow',
      agent: 'A',
      nonce: 1,
      tx_sig: 't',
      request_hash: 'r',
      prev_receipt_hash: null,
      receipt_hash: 'h',
      ts: 'now',
    };
    getReceiptByHashMock.mockResolvedValueOnce({
      receiptHash: 'h',
      network: 'solana-devnet',
      agent: 'A',
      nonce: 1,
      decision: 'allow',
      kind: 'spend',
      txSig: 't',
      paymentRequirementsHash: null,
      ingestedAt: 'now',
      raw: inner,
    });
    const { getReceiptByHash } = await importDb();
    const r = await getReceiptByHash('devnet', 'h');
    expect(r).toEqual(inner);
  });
});

describe('failure mapping', () => {
  beforeEach(() => {
    process.env.LEASH_DB_URL = 'file::memory:';
    getIndexerStatusMock.mockReset();
  });

  it('wraps storage exceptions in DbUnavailableError', async () => {
    getIndexerStatusMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    const { getIndexerStatus, DbUnavailableError } = await importDb();
    await expect(getIndexerStatus('devnet')).rejects.toBeInstanceOf(DbUnavailableError);
  });
});
