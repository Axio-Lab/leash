import { describe, expect, it } from 'vitest';
import {
  addressExplorerUrl,
  agentExplorerUrl,
  transactionExplorerUrl,
} from '../src/explorer/index.js';

describe('explorer URL builders', () => {
  it('returns null for nullish inputs', () => {
    expect(transactionExplorerUrl(null)).toBeNull();
    expect(agentExplorerUrl(undefined)).toBeNull();
    expect(addressExplorerUrl(null)).toBeNull();
  });

  it('builds Solscan tx links for devnet by default', () => {
    expect(transactionExplorerUrl('5sig')).toBe('https://solscan.io/tx/5sig?cluster=devnet');
  });

  it('omits cluster for mainnet', () => {
    expect(transactionExplorerUrl('5sig', { network: 'mainnet' })).toBe(
      'https://solscan.io/tx/5sig',
    );
  });

  it('supports the explorer.solana.com provider', () => {
    expect(
      transactionExplorerUrl('5sig', { provider: 'solana-explorer', network: 'mainnet' }),
    ).toBe('https://explorer.solana.com/tx/5sig');
  });

  it('uses /address for the official explorer', () => {
    expect(addressExplorerUrl('Mint111', { provider: 'solana-explorer', network: 'mainnet' })).toBe(
      'https://explorer.solana.com/address/Mint111',
    );
  });

  it('agent links delegate to address links', () => {
    expect(agentExplorerUrl('Mint111')).toBe('https://solscan.io/account/Mint111?cluster=devnet');
  });
});
