/**
 * Wiring tests for `lib/rpc.ts`.
 *
 * The explorer's agent page reads identity + treasury balances directly
 * via Umi, calling into `@leashmarket/api`'s shared snapshot helpers. We
 * stub those out and verify our wrapper:
 *   - picks the correct RPC URL per network (devnet vs mainnet)
 *   - hands the canonical SVM slug to the snapshot helpers
 *   - wraps RPC errors in `RpcUnavailableError`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getAgentSummaryMock = vi.fn();
const getAgentTreasuryBalancesMock = vi.fn();
const umiReadOnlyMock = vi.fn(() => ({}));

vi.mock('@leashmarket/api', () => ({
  getAgentSummary: getAgentSummaryMock,
  getAgentTreasuryBalances: getAgentTreasuryBalancesMock,
  umiReadOnly: umiReadOnlyMock,
}));

describe('getAgentSummaryFor', () => {
  beforeEach(() => {
    process.env.LEASH_RPC_DEVNET = 'https://devnet.example';
    process.env.LEASH_RPC_MAINNET = 'https://mainnet.example';
    getAgentSummaryMock.mockReset();
    umiReadOnlyMock.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('asks for the devnet RPC when network is devnet', async () => {
    getAgentSummaryMock.mockResolvedValueOnce({ agent_asset: 'A' });
    const { getAgentSummaryFor } = await import('../lib/rpc');
    await getAgentSummaryFor('devnet', 'AgentMint');
    expect(umiReadOnlyMock).toHaveBeenCalledWith(
      {
        rpc: {
          'solana-devnet': 'https://devnet.example',
          'solana-mainnet': 'https://mainnet.example',
        },
      },
      'solana-devnet',
    );
    expect(getAgentSummaryMock).toHaveBeenCalledWith({}, 'solana-devnet', 'AgentMint');
  });

  it('passes the mainnet slug for mainnet', async () => {
    getAgentSummaryMock.mockResolvedValueOnce({ agent_asset: 'A' });
    const { getAgentSummaryFor } = await import('../lib/rpc');
    await getAgentSummaryFor('mainnet', 'AgentMint');
    expect(getAgentSummaryMock).toHaveBeenCalledWith({}, 'solana-mainnet', 'AgentMint');
  });

  it('wraps RPC failures in RpcUnavailableError', async () => {
    getAgentSummaryMock.mockRejectedValueOnce(new Error('rpc 502'));
    const { getAgentSummaryFor, RpcUnavailableError } = await import('../lib/rpc');
    await expect(getAgentSummaryFor('devnet', 'A')).rejects.toBeInstanceOf(RpcUnavailableError);
  });
});

describe('getTreasuryBalancesFor', () => {
  beforeEach(() => {
    process.env.LEASH_RPC_DEVNET = 'https://devnet.example';
    process.env.LEASH_RPC_MAINNET = 'https://mainnet.example';
    getAgentTreasuryBalancesMock.mockReset();
  });

  it('forwards the network slug + mint', async () => {
    getAgentTreasuryBalancesMock.mockResolvedValueOnce({ sol: { sol: 0 } });
    const { getTreasuryBalancesFor } = await import('../lib/rpc');
    await getTreasuryBalancesFor('mainnet', 'AgentMint');
    expect(getAgentTreasuryBalancesMock).toHaveBeenCalledWith({}, 'solana-mainnet', 'AgentMint');
  });
});
