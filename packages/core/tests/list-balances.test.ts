import { afterEach, describe, expect, it, vi } from 'vitest';
import { listSplBalances } from '../src/treasury/list-balances.js';

const OWNER = 'CTd5VBFYJnGDGv5DbhWfPmrQ96G5ibvmZiyRPURXNyox';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const SOMETHING_ELSE = 'OtherMint11111111111111111111111111111111111';

function rpcResponder(handlers: Record<string, unknown>) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    const method = body?.method as string;
    const result = handlers[method] ?? null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('listSplBalances', () => {
  it('enumerates SPL balances and pins missing stables with zero', async () => {
    const fetchMock = rpcResponder({
      getBalance: { value: 5_000_000_000 },
      getTokenAccountsByOwner: {
        value: [
          {
            pubkey: 'AtaPubkey1',
            account: {
              data: {
                parsed: {
                  info: {
                    mint: SOMETHING_ELSE,
                    tokenAmount: { amount: '12000000', decimals: 6, uiAmount: 12 },
                  },
                },
              },
            },
          },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listSplBalances({
      owner: OWNER,
      rpcUrl: 'https://api.devnet.solana.com',
      network: 'devnet',
    });
    expect(result.sol).toBe(5);
    expect(result.lamports).toBe('5000000000');
    const usdc = result.tokens.find((t) => t.mint === USDC_DEVNET);
    expect(usdc?.amount).toBe('0');
    expect(usdc?.symbol).toBe('USDC');
    const other = result.tokens.find((t) => t.mint === SOMETHING_ELSE);
    expect(other?.amount).toBe('12000000');
    expect(other?.known).toBe(false);
  });

  it('skips stable pinning when disabled', async () => {
    const fetchMock = rpcResponder({
      getBalance: { value: 0 },
      getTokenAccountsByOwner: { value: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listSplBalances({
      owner: OWNER,
      rpcUrl: 'https://api.devnet.solana.com',
      network: 'devnet',
      pinKnownStables: false,
    });
    expect(result.tokens).toHaveLength(0);
  });
});
