import { describe, expect, it } from 'vitest';
import {
  deriveAgentTreasuryAddress,
  deriveAgentTreasuryAta,
  MPL_CORE_PROGRAM_ADDRESS,
} from '../src/agent/treasury-pda.js';

const ASSET = '33QvAYjEiK8UMrmpy3LW6W8v2wpPMahnw7Jvr7JpeQrR';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('deriveAgentTreasuryAddress', () => {
  it('exposes the canonical Metaplex Core program ID', () => {
    expect(MPL_CORE_PROGRAM_ADDRESS).toBe('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');
  });

  it('is deterministic for the same asset', async () => {
    const a = await deriveAgentTreasuryAddress(ASSET);
    const b = await deriveAgentTreasuryAddress(ASSET);
    expect(String(a)).toBe(String(b));
    // Sanity-check: base58 32-byte address.
    expect(String(a).length).toBeGreaterThanOrEqual(32);
  });

  it('produces different PDAs for different assets', async () => {
    const a = await deriveAgentTreasuryAddress(ASSET);
    const b = await deriveAgentTreasuryAddress('11111111111111111111111111111111');
    expect(String(a)).not.toBe(String(b));
  });

  it('derives the treasury ATA for a given mint', async () => {
    const { treasury, ata } = await deriveAgentTreasuryAta({
      asset: ASSET,
      mint: USDC_DEVNET,
    });
    // ATA must be distinct from the treasury PDA.
    expect(String(ata)).not.toBe(String(treasury));
    expect(String(ata).length).toBeGreaterThanOrEqual(32);
  });
});
