import { describe, it, expect } from 'vitest';

import { createTestRig, authedFetch } from './helpers.js';
import {
  ensureWatched,
  getCursor,
  listWatchlist,
  runIndexerTick,
  runReceiptPullTick,
  type RpcClient,
  type RpcParsedTransaction,
  type RpcSignature,
} from '../src/indexer/index.js';
import { listEvents } from '../src/storage/events.js';
import {
  MPL_AGENT_IDENTITY_PROGRAM_ID,
  MPL_AGENT_TOOLS_PROGRAM_ID,
  MPL_CORE_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
} from '../src/indexer/programs.js';

const ASSET = 'BcN4ToBs8jE3dbYNhYqDJqGnKPjH3zRX8gsDUDH72JQp';
const TREASURY = '9pAtwmrwz1MRzo2eRznmUE93U7L2JQy7uTvwgU5jjFi3';
const USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PAYER = '6vWQv7PYYJ43uM3yHrUrLoXkWE3TUkHRMyYstUjt8gnj';

/**
 * Build a minimal `RpcClient` stub that returns canned signatures and
 * transactions per address. Tests own the lookup tables so we can craft
 * exactly the log/program-id shape each decoder branch expects.
 */
function makeStubRpc(opts: {
  sigsByAddress: Record<string, RpcSignature[]>;
  txsBySig: Record<string, RpcParsedTransaction>;
}): RpcClient {
  return {
    async getSignaturesForAddress(args) {
      const all = opts.sigsByAddress[args.address] ?? [];
      // RPC returns newest-first; honour `until` by truncating once we
      // pass the cursor, exactly like the real RPC.
      if (args.until) {
        const idx = all.findIndex((s) => s.signature === args.until);
        return idx >= 0 ? all.slice(0, idx) : all;
      }
      return all;
    },
    async getTransaction(args) {
      return opts.txsBySig[args.signature] ?? null;
    },
  };
}

function tx(opts: {
  signature: string;
  slot?: number;
  programIds: string[];
  logs: string[];
  accountKeys?: string[];
  tokenBalanceDeltas?: Array<{ owner: string; mint: string; delta: string }>;
  lamportDeltas?: Array<{ pubkey: string; delta: string }>;
  err?: unknown;
}): RpcParsedTransaction {
  return {
    signature: opts.signature,
    slot: opts.slot ?? 1,
    blockTime: 1700000000,
    err: opts.err ?? null,
    logs: opts.logs,
    programIds: opts.programIds,
    accountKeys: opts.accountKeys ?? [PAYER, ASSET, TREASURY],
    tokenBalanceDeltas: opts.tokenBalanceDeltas ?? [],
    lamportDeltas: opts.lamportDeltas ?? [],
  };
}

describe('indexer', () => {
  it('decodes identity register, executive register, delegation set, treasury withdraw', async () => {
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });

    const sigsAsset: RpcSignature[] = [
      { signature: 'sigCreate', slot: 100, blockTime: null, err: null },
      { signature: 'sigExec', slot: 101, blockTime: null, err: null },
      { signature: 'sigSetDel', slot: 102, blockTime: null, err: null },
    ];
    const sigsTreasury: RpcSignature[] = [
      { signature: 'sigWithdraw', slot: 103, blockTime: null, err: null },
    ];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      sigCreate: tx({
        signature: 'sigCreate',
        programIds: [MPL_AGENT_IDENTITY_PROGRAM_ID],
        logs: [
          `Program ${MPL_AGENT_IDENTITY_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: CreateIdentity',
          `Program ${MPL_AGENT_IDENTITY_PROGRAM_ID} success`,
        ],
      }),
      sigExec: tx({
        signature: 'sigExec',
        programIds: [MPL_AGENT_TOOLS_PROGRAM_ID],
        logs: [
          `Program ${MPL_AGENT_TOOLS_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: CreateExecutive',
          `Program ${MPL_AGENT_TOOLS_PROGRAM_ID} success`,
        ],
      }),
      sigSetDel: tx({
        signature: 'sigSetDel',
        programIds: [SPL_TOKEN_PROGRAM_ID],
        logs: [
          `Program ${SPL_TOKEN_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: Approve',
          `Program ${SPL_TOKEN_PROGRAM_ID} success`,
        ],
      }),
      sigWithdraw: tx({
        signature: 'sigWithdraw',
        programIds: [MPL_CORE_PROGRAM_ID, SPL_TOKEN_PROGRAM_ID],
        logs: [
          `Program ${MPL_CORE_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: Execute',
          `Program ${SPL_TOKEN_PROGRAM_ID} invoke [2]`,
          'Program log: Instruction: TransferChecked',
          `Program ${SPL_TOKEN_PROGRAM_ID} success`,
          `Program ${MPL_CORE_PROGRAM_ID} success`,
        ],
        tokenBalanceDeltas: [
          { owner: TREASURY, mint: USDC, delta: '-500000' },
          { owner: PAYER, mint: USDC, delta: '500000' },
        ],
      }),
    };
    const rpc = makeStubRpc({
      sigsByAddress: { [ASSET]: sigsAsset, [TREASURY]: sigsTreasury },
      txsBySig,
    });

    const r = await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    expect(r.addressesScanned).toBe(2);
    expect(r.signaturesFetched).toBe(4);
    expect(r.eventsWritten).toBe(4);
    expect(r.errors).toBe(0);

    const events = await listEvents(rig.db, {
      network: 'solana-devnet',
      agent: ASSET,
      limit: 50,
    });
    const kinds = events.map((e) => e.kind).sort();
    expect(kinds).toEqual(
      [
        'agent.delegation.set',
        'agent.executive.register',
        'agent.identity.register',
        'agent.treasury.withdraw',
      ].sort(),
    );
    const withdraw = events.find((e) => e.kind === 'agent.treasury.withdraw');
    expect(withdraw?.amountAtomic).toBe('500000');
    expect(withdraw?.mint).toBe(USDC);
    expect(withdraw?.signature).toBe('sigWithdraw');
    expect(withdraw?.phase).toBe('confirmed');
  });

  it('is idempotent across consecutive ticks (cursors prevent rework)', async () => {
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const sigs: RpcSignature[] = [
      { signature: 'sigA', slot: 200, blockTime: null, err: null },
      { signature: 'sigB', slot: 201, blockTime: null, err: null },
    ];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      sigA: tx({
        signature: 'sigA',
        programIds: [MPL_AGENT_IDENTITY_PROGRAM_ID],
        logs: [
          `Program ${MPL_AGENT_IDENTITY_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: CreateIdentity',
          `Program ${MPL_AGENT_IDENTITY_PROGRAM_ID} success`,
        ],
      }),
      sigB: tx({
        signature: 'sigB',
        programIds: [MPL_AGENT_IDENTITY_PROGRAM_ID],
        logs: [
          `Program ${MPL_AGENT_IDENTITY_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: UpdateIdentity',
          `Program ${MPL_AGENT_IDENTITY_PROGRAM_ID} success`,
        ],
      }),
    };
    const rpc = makeStubRpc({
      sigsByAddress: { [ASSET]: sigs, [TREASURY]: [] },
      txsBySig,
    });

    const first = await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    expect(first.eventsWritten).toBe(2);

    // Second tick: cursor should match latest signature → no new fetches
    // beyond what the stub would still return; events written must be 0.
    const second = await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    expect(second.eventsWritten).toBe(0);

    const c = await getCursor(rig.db, {
      network: 'solana-devnet',
      address: ASSET,
      kind: 'asset',
    });
    expect(c?.lastSignature).toBe('sigA'); // newest in the canned list (RPC returns newest-first; loop walks oldest-first to advance monotonically, so last-seen is oldest-of-the-latest-batch). The cursor is correctly pinned to the most recent signature observed.
    expect(c?.backfillComplete).toBe(true);
  });

  it('records on-chain failed transactions with phase=failed', async () => {
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const sigs: RpcSignature[] = [
      {
        signature: 'sigBoom',
        slot: 300,
        blockTime: null,
        err: { InstructionError: [0, 'Custom'] },
      },
    ];
    const rpc = makeStubRpc({
      sigsByAddress: { [ASSET]: sigs, [TREASURY]: [] },
      txsBySig: {
        sigBoom: tx({
          signature: 'sigBoom',
          err: { InstructionError: [0, 'Custom'] },
          programIds: [MPL_AGENT_IDENTITY_PROGRAM_ID],
          logs: [
            `Program ${MPL_AGENT_IDENTITY_PROGRAM_ID} invoke [1]`,
            'Program log: Instruction: CreateIdentity',
            `Program ${MPL_AGENT_IDENTITY_PROGRAM_ID} failed: custom program error`,
          ],
        }),
      },
    });
    await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    const events = await listEvents(rig.db, { network: 'solana-devnet', agent: ASSET });
    const failed = events.find((e) => e.signature === 'sigBoom');
    expect(failed?.phase).toBe('failed');
    expect(failed?.metadata['on_chain_failed']).toBe(true);
  });

  it('does not pollute mainnet when only devnet has watchlist entries', async () => {
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const rpc = makeStubRpc({ sigsByAddress: {}, txsBySig: {} });
    const r = await runIndexerTick({ db: rig.db, rpc, network: 'solana-mainnet' });
    expect(r.addressesScanned).toBe(0);
    const wl = await listWatchlist(rig.db, 'solana-mainnet');
    expect(wl).toHaveLength(0);
  });

  it('pulls receipts from a registered URL and writes receipt.pulled events', async () => {
    const rig = await createTestRig();
    const url = 'https://merchant.test/agents/{agent}/receipts.jsonl';
    await rig.db.execute({
      sql: `INSERT INTO pull_targets (network, agent, url) VALUES ('solana-devnet', ?, ?)`,
      args: [ASSET, url],
    });

    const { finalizeReceipt } = await import('@leash/core');
    const r1 = finalizeReceipt({
      v: '0.1',
      kind: 'spend',
      agent: ASSET,
      nonce: 0,
      ts: '2026-04-23T12:00:00.000Z',
      policy_v: '0.1',
      request: { method: 'POST', url: 'http://merchant.test/echo', body_hash: null },
      decision: 'allow',
      reason: null,
      price: { amount: '0.01', currency: 'USDC' },
      facilitator: 'https://facilitator.svmacc.tech',
      tx_sig: null,
      response: { status: 200, body_hash: null },
      prev_receipt_hash: null,
    });
    const r2 = finalizeReceipt({
      v: '0.1',
      kind: 'spend',
      agent: ASSET,
      nonce: 1,
      ts: '2026-04-23T12:01:00.000Z',
      policy_v: '0.1',
      request: { method: 'POST', url: 'http://merchant.test/echo2', body_hash: null },
      decision: 'allow',
      reason: null,
      price: { amount: '0.01', currency: 'USDC' },
      facilitator: 'https://facilitator.svmacc.tech',
      tx_sig: null,
      response: { status: 200, body_hash: null },
      prev_receipt_hash: r1.receipt_hash,
    });
    const expectedFetchUrl = url.replaceAll('{agent}', ASSET);
    const stubFetch: typeof globalThis.fetch = (async (input, _init) => {
      expect(String(input)).toBe(expectedFetchUrl);
      const body = `${JSON.stringify(r1)}\n${JSON.stringify(r2)}\n`;
      return new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/jsonl' },
      });
    }) as typeof globalThis.fetch;

    const out = await runReceiptPullTick({
      db: rig.db,
      network: 'solana-devnet',
      options: { fetch: stubFetch },
    });
    expect(out.targetsScanned).toBe(1);
    expect(out.receiptsIngested).toBe(2);
    expect(out.receiptsDuplicate).toBe(0);

    const list = await authedFetch(rig, `/v1/receipts/${ASSET}`);
    const body = (await list.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(2);

    const ev = await authedFetch(rig, `/v1/events?kind=receipt.pulled&agent=${ASSET}`);
    const evBody = (await ev.json()) as { items: Array<{ kind: string }> };
    expect(evBody.items).toHaveLength(2);
    expect(evBody.items.every((it) => it.kind === 'receipt.pulled')).toBe(true);
  });

  it('GET /v1/indexer/status reports watchlist + cursor state for the caller network', async () => {
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const res = await authedFetch(rig, '/v1/indexer/status');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      network: string;
      watchlist_size: number;
      cursors: { total: number; last_run_at: string | null };
      events_last_hour: Record<string, number>;
    };
    expect(body.network).toBe('solana-devnet');
    expect(body.watchlist_size).toBe(2); // asset + treasury
  });
});
