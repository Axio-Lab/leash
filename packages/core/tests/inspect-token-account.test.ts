import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectSplTokenAccount } from '../src/treasury/inspect-token-account.js';

const ATA = 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox';

function rpcResponder(value: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('inspectSplTokenAccount', () => {
  it('returns null when the account does not exist', async () => {
    vi.stubGlobal('fetch', rpcResponder(null));
    const state = await inspectSplTokenAccount({
      rpcUrl: 'https://devnet',
      address: ATA,
    });
    expect(state).toBeNull();
  });

  it('parses jsonParsed token account state with delegate', async () => {
    vi.stubGlobal(
      'fetch',
      rpcResponder({
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        data: {
          program: 'spl-token',
          parsed: {
            type: 'account',
            info: {
              mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
              owner: 'OwnerPubkey1111111111111111111111111111111111',
              tokenAmount: { amount: '5000000', decimals: 6 },
              delegate: 'EsUwETXyz4A1u',
              delegatedAmount: { amount: '2500000', decimals: 6 },
            },
          },
        },
      }),
    );
    const state = await inspectSplTokenAccount({
      rpcUrl: 'https://devnet',
      address: ATA,
    });
    expect(state).not.toBeNull();
    expect(state!.amount).toBe(5_000_000n);
    expect(state!.delegate).toBe('EsUwETXyz4A1u');
    expect(state!.delegatedAmount).toBe(2_500_000n);
    expect(state!.program).toBe('spl-token');
  });

  it('returns delegatedAmount=0 when delegate is absent', async () => {
    vi.stubGlobal(
      'fetch',
      rpcResponder({
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        data: {
          program: 'spl-token',
          parsed: {
            type: 'account',
            info: {
              mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
              owner: 'OwnerPubkey1111111111111111111111111111111111',
              tokenAmount: { amount: '12000000', decimals: 6 },
            },
          },
        },
      }),
    );
    const state = await inspectSplTokenAccount({
      rpcUrl: 'https://devnet',
      address: ATA,
    });
    expect(state!.delegate).toBeNull();
    expect(state!.delegatedAmount).toBe(0n);
  });
});
