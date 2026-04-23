/**
 * Unit tests for `withdraw-sol.ts`.
 *
 * We mock `mpl-core::execute` and Umi's RPC layer so the helpers can be
 * exercised offline. The tests assert on:
 *   - The shape of the System.Transfer instruction we construct (right
 *     program id, account ordering, signer flag, encoded discriminator
 *     and amount).
 *   - `withdrawTreasurySolAll`'s no-op + reserve subtraction behaviour.
 *   - `getTreasurySolBalance`'s lamport → SOL conversion + reserve
 *     application.
 */

import { describe, expect, it, vi } from 'vitest';
import { publicKey } from '@metaplex-foundation/umi';
import type { Umi, PublicKey } from '@metaplex-foundation/umi';

const FAKE_TREASURY = publicKey('11111111111111111111111111111112');

const mocks = vi.hoisted(() => ({
  execute: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
}));
mocks.execute = vi.fn();

vi.mock('@metaplex-foundation/mpl-core', () => ({
  findAssetSignerPda: () => [FAKE_TREASURY, 255],
  execute: (...args: unknown[]) => mocks.execute(...args),
}));

import {
  withdrawTreasurySol,
  withdrawTreasurySolAll,
  prepareWithdrawTreasurySol,
  prepareWithdrawTreasurySolAll,
  getTreasurySolBalance,
  SYSTEM_PROGRAM_ID,
  DEFAULT_SOL_RESERVE_LAMPORTS,
} from '../src/withdraw-sol.js';

const FAKE_ASSET = publicKey('11111111111111111111111111111113');
const FAKE_DEST = publicKey('11111111111111111111111111111114');

function makeUmi(opts: { lamports?: bigint } = {}): Umi {
  const lamports = opts.lamports ?? 0n;
  return {
    rpc: {
      getBalance: vi.fn(async () => ({
        basisPoints: lamports,
        identifier: 'SOL',
        decimals: 9,
      })),
    },
  } as unknown as Umi;
}

function captureLastBuilder() {
  expect(mocks.execute).toHaveBeenCalled();
  const lastCall = mocks.execute.mock.calls[mocks.execute.mock.calls.length - 1] as unknown[];
  const args = lastCall[1] as {
    instructions: Array<{ programId: PublicKey; keys: unknown[]; data: Uint8Array }>;
  };
  return args.instructions[0];
}

describe('withdrawTreasurySol', () => {
  it('builds a valid SystemProgram.Transfer wrapped in mpl-core::Execute', async () => {
    mocks.execute.mockReturnValue({
      sendAndConfirm: async () => ({
        // Empty signature works because base58.deserialize handles a 64-byte zeroed array.
        signature: new Uint8Array(64),
      }),
    });

    const umi = makeUmi();
    const result = await withdrawTreasurySol(umi, {
      agentAsset: FAKE_ASSET,
      destination: FAKE_DEST,
      lamports: 1_000_000n,
    });

    expect(result.treasury).toBe(String(FAKE_TREASURY));
    expect(result.destination).toBe(String(FAKE_DEST));
    expect(result.lamports).toBe(1_000_000n);

    const ix = captureLastBuilder();
    expect(String(ix.programId)).toBe(String(SYSTEM_PROGRAM_ID));
    // 4-byte u32 LE discriminator (2) + 8-byte u64 LE amount = 12 bytes.
    expect(ix.data.length).toBe(12);
    expect(ix.data[0]).toBe(2);
    const dv = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    expect(dv.getBigUint64(4, true)).toBe(1_000_000n);

    // First account is the treasury PDA, declared as signer + writable so
    // mpl-core's Execute can rewrite the signer flag during CPI.
    const keys = ix.keys as Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>;
    expect(keys).toHaveLength(2);
    expect(String(keys[0].pubkey)).toBe(String(FAKE_TREASURY));
    expect(keys[0].isSigner).toBe(true);
    expect(keys[0].isWritable).toBe(true);
    expect(String(keys[1].pubkey)).toBe(String(FAKE_DEST));
    expect(keys[1].isSigner).toBe(false);
    expect(keys[1].isWritable).toBe(true);
  });

  it('rejects a non-positive lamport amount', async () => {
    const umi = makeUmi();
    await expect(
      withdrawTreasurySol(umi, {
        agentAsset: FAKE_ASSET,
        destination: FAKE_DEST,
        lamports: 0n,
      }),
    ).rejects.toThrow(/positive/);
  });
});

describe('withdrawTreasurySolAll', () => {
  it('returns null without broadcasting when the balance is at or below the reserve', async () => {
    mocks.execute.mockClear();
    const umi = makeUmi({ lamports: DEFAULT_SOL_RESERVE_LAMPORTS });
    const result = await withdrawTreasurySolAll(umi, {
      agentAsset: FAKE_ASSET,
      destination: FAKE_DEST,
    });
    expect(result).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('drains balance minus the default reserve when funds are available', async () => {
    mocks.execute.mockReturnValue({
      sendAndConfirm: async () => ({ signature: new Uint8Array(64) }),
    });
    const umi = makeUmi({ lamports: 2_000_000n });
    const result = await withdrawTreasurySolAll(umi, {
      agentAsset: FAKE_ASSET,
      destination: FAKE_DEST,
    });
    expect(result).not.toBeNull();
    expect(result!.lamports).toBe(2_000_000n - DEFAULT_SOL_RESERVE_LAMPORTS);
  });

  it('honours a custom reserveLamports override', async () => {
    mocks.execute.mockReturnValue({
      sendAndConfirm: async () => ({ signature: new Uint8Array(64) }),
    });
    const umi = makeUmi({ lamports: 1_000_000n });
    const result = await withdrawTreasurySolAll(umi, {
      agentAsset: FAKE_ASSET,
      destination: FAKE_DEST,
      reserveLamports: 100_000n,
    });
    expect(result!.lamports).toBe(900_000n);
  });
});

describe('prepareWithdrawTreasurySol', () => {
  it('returns the unsigned builder + echo without sending', () => {
    const fakeBuilder = { sendAndConfirm: vi.fn() };
    mocks.execute.mockReturnValueOnce(fakeBuilder);

    const umi = makeUmi();
    const prepared = prepareWithdrawTreasurySol(umi, {
      agentAsset: FAKE_ASSET,
      destination: FAKE_DEST,
      lamports: 250_000n,
    });

    expect(prepared.builder).toBe(fakeBuilder);
    expect(prepared.treasury).toBe(String(FAKE_TREASURY));
    expect(prepared.destination).toBe(String(FAKE_DEST));
    expect(prepared.lamports).toBe(250_000n);
    expect(fakeBuilder.sendAndConfirm).not.toHaveBeenCalled();
  });

  it('rejects a non-positive lamport amount before reaching execute', () => {
    mocks.execute.mockClear();
    const umi = makeUmi();
    expect(() =>
      prepareWithdrawTreasurySol(umi, {
        agentAsset: FAKE_ASSET,
        destination: FAKE_DEST,
        lamports: 0n,
      }),
    ).toThrow(/positive/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

describe('prepareWithdrawTreasurySolAll', () => {
  it('returns null when balance is at or below the reserve', async () => {
    mocks.execute.mockClear();
    const umi = makeUmi({ lamports: DEFAULT_SOL_RESERVE_LAMPORTS });
    const prepared = await prepareWithdrawTreasurySolAll(umi, {
      agentAsset: FAKE_ASSET,
      destination: FAKE_DEST,
    });
    expect(prepared).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('returns a prepared transfer for the spendable balance', async () => {
    const fakeBuilder = { sendAndConfirm: vi.fn() };
    mocks.execute.mockReturnValueOnce(fakeBuilder);
    const umi = makeUmi({ lamports: 3_000_000n });
    const prepared = await prepareWithdrawTreasurySolAll(umi, {
      agentAsset: FAKE_ASSET,
      destination: FAKE_DEST,
    });
    expect(prepared).not.toBeNull();
    expect(prepared!.lamports).toBe(3_000_000n - DEFAULT_SOL_RESERVE_LAMPORTS);
    expect(prepared!.builder).toBe(fakeBuilder);
    expect(fakeBuilder.sendAndConfirm).not.toHaveBeenCalled();
  });
});

describe('getTreasurySolBalance', () => {
  it('reports zero spendable when balance is below the reserve', async () => {
    const umi = makeUmi({ lamports: 100n });
    const r = await getTreasurySolBalance(umi, { agentAsset: FAKE_ASSET });
    expect(r.lamports).toBe(100n);
    expect(r.spendableLamports).toBe(0n);
    expect(r.spendableSol).toBe(0);
  });

  it('reports correct spendable when balance exceeds the reserve', async () => {
    const umi = makeUmi({ lamports: 1_500_000_000n }); // 1.5 SOL
    const r = await getTreasurySolBalance(umi, {
      agentAsset: FAKE_ASSET,
      reserveLamports: 500_000_000n, // keep 0.5 SOL behind
    });
    expect(r.lamports).toBe(1_500_000_000n);
    expect(r.sol).toBe(1.5);
    expect(r.spendableLamports).toBe(1_000_000_000n);
    expect(r.spendableSol).toBe(1);
    expect(r.treasury).toBe(String(FAKE_TREASURY));
  });
});
