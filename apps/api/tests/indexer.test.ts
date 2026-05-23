import { describe, it, expect } from 'vitest';

import { createTestRig, authedFetch } from './helpers.js';
import {
  _resetDiscoveryCacheForTests,
  ensureWatched,
  ensureWatchedAta,
  ensureWatchedFeeAta,
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

  it('decodes incoming SPL transfers to the treasury PDA as agent.treasury.fund', async () => {
    // Regression: incoming transfers used to be invisible to the
    // explorer because the decoder only fired inside the mpl-core
    // `Execute` branch (= withdraws). A raw SPL `TransferChecked`
    // landing in the treasury ATA now produces a `fund` row so owner
    // top-ups (and x402 settlements) show up in the activity feed.
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const sigs: RpcSignature[] = [{ signature: 'sigFund', slot: 400, blockTime: null, err: null }];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      sigFund: tx({
        signature: 'sigFund',
        programIds: [SPL_TOKEN_PROGRAM_ID],
        // Plain SPL TransferChecked from owner -> treasury ATA.
        // Crucially: NO mpl-core Execute log, so this exercises the
        // pure "fund detection" branch.
        logs: [
          `Program ${SPL_TOKEN_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: TransferChecked',
          `Program ${SPL_TOKEN_PROGRAM_ID} success`,
        ],
        tokenBalanceDeltas: [
          { owner: PAYER, mint: USDC, delta: '-1000000' },
          { owner: TREASURY, mint: USDC, delta: '1000000' },
        ],
      }),
    };
    const rpc = makeStubRpc({
      sigsByAddress: { [ASSET]: [], [TREASURY]: sigs },
      txsBySig,
    });
    const r = await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    expect(r.eventsWritten).toBe(1);
    const events = await listEvents(rig.db, { network: 'solana-devnet', agent: ASSET });
    const fund = events.find((e) => e.kind === 'agent.treasury.fund');
    expect(fund?.amountAtomic).toBe('1000000');
    expect(fund?.mint).toBe(USDC);
    expect(fund?.signature).toBe('sigFund');
    expect(fund?.phase).toBe('confirmed');
    // Withdraw and fund are mutually exclusive on the same tx.
    expect(events.find((e) => e.kind === 'agent.treasury.withdraw')).toBeUndefined();
  });

  it('does not emit agent.treasury.fund for the withdraw side of an Execute', async () => {
    // Defence in depth: a withdraw decreases the treasury balance, so
    // the positive-delta branch must not fire. We assert this by
    // re-using the same withdraw fixture as the main happy-path test
    // and confirming only `withdraw` (not `fund`) was written.
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const sigs: RpcSignature[] = [
      { signature: 'sigWithdrawOnly', slot: 410, blockTime: null, err: null },
    ];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      sigWithdrawOnly: tx({
        signature: 'sigWithdrawOnly',
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
          { owner: TREASURY, mint: USDC, delta: '-250000' },
          { owner: PAYER, mint: USDC, delta: '250000' },
        ],
      }),
    };
    const rpc = makeStubRpc({
      sigsByAddress: { [ASSET]: [], [TREASURY]: sigs },
      txsBySig,
    });
    await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    const events = await listEvents(rig.db, { network: 'solana-devnet', agent: ASSET });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('agent.treasury.withdraw');
    expect(kinds).not.toContain('agent.treasury.fund');
  });

  it('decodes incoming SOL transfers to the treasury PDA as agent.treasury.fund_sol', async () => {
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const sigs: RpcSignature[] = [
      { signature: 'sigFundSol', slot: 420, blockTime: null, err: null },
    ];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      sigFundSol: tx({
        signature: 'sigFundSol',
        programIds: [],
        logs: [
          'Program 11111111111111111111111111111111 invoke [1]',
          'Program 11111111111111111111111111111111 success',
        ],
        lamportDeltas: [
          { pubkey: PAYER, delta: '-100000000' },
          { pubkey: TREASURY, delta: '100000000' },
        ],
      }),
    };
    const rpc = makeStubRpc({
      sigsByAddress: { [ASSET]: [], [TREASURY]: sigs },
      txsBySig,
    });
    await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    const events = await listEvents(rig.db, { network: 'solana-devnet', agent: ASSET });
    const fund = events.find((e) => e.kind === 'agent.treasury.fund_sol');
    expect(fund?.amountAtomic).toBe('100000000');
    expect(fund?.signature).toBe('sigFundSol');
  });

  it('decodes plain SPL deposits via treasury_ata watch (PDA not in account list)', async () => {
    // The realistic deposit shape: a third party broadcasts a plain
    // `TransferChecked` whose account list contains the treasury's
    // ATA but not the PDA itself. `getSignaturesForAddress(pda)`
    // therefore never surfaces this signature — only
    // `getSignaturesForAddress(ata)` does. The decoder must use
    // `ctx.treasuryAddress` (= the PDA) to filter the
    // `tokenBalanceDeltas`, since the PDA is what owns the ATA.
    _resetDiscoveryCacheForTests();
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const ATA = '7tH8AqkZQXMQTwY9SwtA1xZUjzLNqEqxXnVk7knKL3aE';
    await ensureWatchedAta(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      ataAddress: ATA,
    });
    const sigs: RpcSignature[] = [
      { signature: 'sigDeposit', slot: 440, blockTime: null, err: null },
    ];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      sigDeposit: tx({
        signature: 'sigDeposit',
        programIds: [SPL_TOKEN_PROGRAM_ID],
        // Account list contains the buyer, the buyer's ATA, the
        // treasury's ATA, and the mint — but NOT the PDA.
        accountKeys: [PAYER, ATA, USDC, SPL_TOKEN_PROGRAM_ID],
        logs: [
          `Program ${SPL_TOKEN_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: TransferChecked',
          `Program ${SPL_TOKEN_PROGRAM_ID} success`,
        ],
        tokenBalanceDeltas: [
          { owner: PAYER, mint: USDC, delta: '-2500000' },
          { owner: TREASURY, mint: USDC, delta: '2500000' },
        ],
      }),
    };
    const rpc = makeStubRpc({
      // Critically: the PDA returns no sigs; only the ATA does.
      sigsByAddress: { [ASSET]: [], [TREASURY]: [], [ATA]: sigs },
      txsBySig,
    });
    const r = await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    expect(r.eventsWritten).toBe(1);
    const events = await listEvents(rig.db, { network: 'solana-devnet', agent: ASSET });
    const fund = events.find((e) => e.kind === 'agent.treasury.fund');
    expect(fund?.amountAtomic).toBe('2500000');
    expect(fund?.mint).toBe(USDC);
    expect(fund?.signature).toBe('sigDeposit');
    expect(fund?.phase).toBe('confirmed');
  });

  it('runs treasury ATA discovery once per agent and adds rows to the watchlist', async () => {
    // Lazy bootstrap: the indexer asks the RPC for every SPL account
    // owned by each treasury PDA the first time it sees the agent,
    // adds them to the watchlist, then re-uses the result on
    // subsequent ticks. This is what lets a freshly-restarted
    // indexer pick up an agent that was provisioned out-of-band.
    _resetDiscoveryCacheForTests();
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const ATA = '7tH8AqkZQXMQTwY9SwtA1xZUjzLNqEqxXnVk7knKL3aE';
    let discoverCalls = 0;
    const rpc = makeStubRpc({ sigsByAddress: {}, txsBySig: {} });

    await runIndexerTick({
      db: rig.db,
      rpc,
      network: 'solana-devnet',
      options: {
        discoverTreasuryAtas: async ({ treasuryAddress }) => {
          discoverCalls += 1;
          expect(treasuryAddress).toBe(TREASURY);
          return [ATA];
        },
      },
    });
    expect(discoverCalls).toBe(1);
    const wl1 = await listWatchlist(rig.db, 'solana-devnet');
    expect(wl1.find((r) => r.kind === 'treasury_ata' && r.address === ATA)).toBeDefined();

    // Second tick on the same process: discovery cache short-circuits.
    await runIndexerTick({
      db: rig.db,
      rpc,
      network: 'solana-devnet',
      options: {
        discoverTreasuryAtas: async () => {
          discoverCalls += 1;
          return [];
        },
      },
    });
    expect(discoverCalls).toBe(1);
  });

  it('skips dust-sized lamport wobbles below the fee threshold', async () => {
    // Without the floor, every ATA-rent rebate would generate a
    // spurious "fund_sol" row. Rebates are a few thousand lamports;
    // the threshold is 5 000 (the typical signature fee).
    const rig = await createTestRig();
    await ensureWatched(rig.db, {
      network: 'solana-devnet',
      agentAsset: ASSET,
      treasuryAddress: TREASURY,
    });
    const sigs: RpcSignature[] = [{ signature: 'sigDust', slot: 430, blockTime: null, err: null }];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      sigDust: tx({
        signature: 'sigDust',
        programIds: [],
        logs: [],
        lamportDeltas: [{ pubkey: TREASURY, delta: '4999' }],
      }),
    };
    const rpc = makeStubRpc({
      sigsByAddress: { [ASSET]: [], [TREASURY]: sigs },
      txsBySig,
    });
    await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    const events = await listEvents(rig.db, { network: 'solana-devnet', agent: ASSET });
    expect(events.find((e) => e.kind === 'agent.treasury.fund_sol')).toBeUndefined();
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

  it('decodes positive SPL inflows on a `leash_fee_ata` watch as protocol.fee.collected', async () => {
    // The fee-ata branch is the on-chain fallback: even if the seller
    // never POSTs a receipt, an inflow to the configured Leash fee
    // authority's ATA should still surface in the explorer's
    // "Protocol fees collected" feed.
    const rig = await createTestRig();
    const FEE_AUTHORITY = '3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W';
    const FEE_ATA = 'GfeeAtaUsdcDevnet111111111111111111111111111';
    await ensureWatchedFeeAta(rig.db, {
      network: 'solana-devnet',
      feeAuthority: FEE_AUTHORITY,
      ataAddress: FEE_ATA,
    });

    const sigs: RpcSignature[] = [{ signature: 'sigFeeIn', slot: 600, blockTime: null, err: null }];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      sigFeeIn: tx({
        signature: 'sigFeeIn',
        programIds: [SPL_TOKEN_PROGRAM_ID],
        accountKeys: [PAYER, FEE_ATA, USDC, SPL_TOKEN_PROGRAM_ID],
        logs: [
          `Program ${SPL_TOKEN_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: TransferChecked',
          `Program ${SPL_TOKEN_PROGRAM_ID} success`,
        ],
        tokenBalanceDeltas: [
          { owner: PAYER, mint: USDC, delta: '-10000' },
          { owner: FEE_AUTHORITY, mint: USDC, delta: '10000' },
        ],
      }),
    };
    const rpc = makeStubRpc({
      sigsByAddress: { [FEE_ATA]: sigs },
      txsBySig,
    });

    const r = await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    expect(r.eventsWritten).toBe(1);

    const all = await listEvents(rig.db, {
      kind: 'protocol.fee.collected',
      network: 'solana-devnet',
      limit: 10,
    });
    expect(all.length).toBe(1);
    const ev = all[0]!;
    expect(ev.amountAtomic).toBe('10000');
    expect(ev.mint).toBe(USDC);
    expect(ev.signature).toBe('sigFeeIn');
    expect(ev.metadata['fee_authority']).toBe(FEE_AUTHORITY);
    expect(ev.metadata['fee_ata']).toBe(FEE_ATA);
    // The chain-event writer stamps `source: 'indexer'` over whatever
    // the decoder set, so the explorer can tell on-chain rows apart
    // from receipt-side ingestion.
    expect(ev.metadata['source']).toBe('indexer');
    // Crucially: NO treasury.fund event was minted for the fee leg.
    const fund = (await listEvents(rig.db, { network: 'solana-devnet', limit: 50 })).find(
      (e) => e.kind === 'agent.treasury.fund',
    );
    expect(fund).toBeUndefined();
  });

  it('does not emit protocol.fee.collected when the fee authority has no positive delta', async () => {
    const rig = await createTestRig();
    const FEE_AUTHORITY = '3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W';
    const FEE_ATA = 'GfeeAtaUsdcDevnet222222222222222222222222222';
    await ensureWatchedFeeAta(rig.db, {
      network: 'solana-devnet',
      feeAuthority: FEE_AUTHORITY,
      ataAddress: FEE_ATA,
    });
    const sigs: RpcSignature[] = [
      { signature: 'sigFeeNeg', slot: 601, blockTime: null, err: null },
    ];
    const txsBySig: Record<string, RpcParsedTransaction> = {
      // Outflow from the fee authority — must not register as a fee
      // collection. (The withdraw path is intentionally out of scope
      // for the explorer's fee feed; treasury operations are tracked
      // via a separate dashboard.)
      sigFeeNeg: tx({
        signature: 'sigFeeNeg',
        programIds: [SPL_TOKEN_PROGRAM_ID],
        accountKeys: [FEE_ATA, PAYER, USDC, SPL_TOKEN_PROGRAM_ID],
        logs: [
          `Program ${SPL_TOKEN_PROGRAM_ID} invoke [1]`,
          'Program log: Instruction: TransferChecked',
          `Program ${SPL_TOKEN_PROGRAM_ID} success`,
        ],
        tokenBalanceDeltas: [
          { owner: FEE_AUTHORITY, mint: USDC, delta: '-5000' },
          { owner: PAYER, mint: USDC, delta: '5000' },
        ],
      }),
    };
    const rpc = makeStubRpc({
      sigsByAddress: { [FEE_ATA]: sigs },
      txsBySig,
    });
    await runIndexerTick({ db: rig.db, rpc, network: 'solana-devnet' });
    const evs = await listEvents(rig.db, {
      kind: 'protocol.fee.collected',
      network: 'solana-devnet',
      limit: 10,
    });
    expect(evs.length).toBe(0);
  });

  it('pulls receipts from a registered URL and writes receipt.pulled events', async () => {
    const rig = await createTestRig();
    const url = 'https://merchant.test/agents/{agent}/receipts.jsonl';
    await rig.db.execute({
      sql: `INSERT INTO pull_targets (network, agent, url) VALUES ('solana-devnet', ?, ?)`,
      args: [ASSET, url],
    });

    const { finalizeReceipt } = await import('@leashmarket/core');
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
      facilitator: 'https://facilitator-devnet.leash.market',
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
      facilitator: 'https://facilitator-devnet.leash.market',
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
