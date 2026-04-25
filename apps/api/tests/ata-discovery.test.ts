import { describe, it, expect } from 'vitest';

import { discoverTreasuryAtas } from '../src/indexer/ata-discovery.js';

const TREASURY = '9pAtwmrwz1MRzo2eRznmUE93U7L2JQy7uTvwgU5jjFi3';
const ATA_SPL = '7tH8AqkZQXMQTwY9SwtA1xZUjzLNqEqxXnVk7knKL3aE';
const ATA_2022 = 'J9rLzLoaGxQzt5AkGwUrpxv5KUUrQmt6LmdcNp8DHfWw';

describe('discoverTreasuryAtas', () => {
  it('returns ATAs from both classic SPL and Token-2022 program IDs', async () => {
    const calls: Array<{ programId: string }> = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as {
        params: [string, { programId: string }];
      };
      calls.push({ programId: body.params[1].programId });
      const value =
        body.params[1].programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
          ? [{ pubkey: ATA_SPL }]
          : [{ pubkey: ATA_2022 }];
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const out = await discoverTreasuryAtas({
      rpcUrl: 'https://rpc.test/invalid',
      treasuryAddress: TREASURY,
      fetchImpl,
    });

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.programId).sort()).toEqual([
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
    ]);
    expect(out.sort()).toEqual([ATA_SPL, ATA_2022].sort());
  });

  it('de-duplicates ATAs returned by both programs (defensive)', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: [{ pubkey: ATA_SPL }] } }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const out = await discoverTreasuryAtas({
      rpcUrl: 'https://rpc.test/invalid',
      treasuryAddress: TREASURY,
      fetchImpl,
    });
    expect(out).toEqual([ATA_SPL]);
  });

  it('throws on RPC error responses', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad owner' } }),
        { status: 200 },
      )) as unknown as typeof fetch;

    await expect(
      discoverTreasuryAtas({
        rpcUrl: 'https://rpc.test/invalid',
        treasuryAddress: TREASURY,
        fetchImpl,
      }),
    ).rejects.toThrow(/bad owner/);
  });
});
