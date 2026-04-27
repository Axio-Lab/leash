import { describe, expect, it, vi, beforeEach } from 'vitest';
import { publicKey } from '@metaplex-foundation/umi';
import type { Umi, PublicKey } from '@metaplex-foundation/umi';

// We mock @metaplex-foundation/genesis at the module level so the
// helpers can be exercised without hitting api.metaplex.com. The mock
// captures the inputs the SDK forwards so we can assert on them.
//
// Use vi.hoisted so the spies are defined before vi.mock factories run
// (vi.mock is hoisted to the top of the file by the Vitest transformer).
const mocks = vi.hoisted(() => ({
  createAndRegisterLaunch: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  createLaunch: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  registerLaunch: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  signAndSend: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  safeFetchV2: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  safeFetchV1: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  setAgentTokenV1: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  findAssetSignerPda: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  execute: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
}));

// Wire vi.fn instances after hoist (mocks object reference is stable).
mocks.createAndRegisterLaunch = vi.fn();
mocks.createLaunch = vi.fn();
mocks.registerLaunch = vi.fn();
mocks.signAndSend = vi.fn();
mocks.safeFetchV2 = vi.fn();
mocks.safeFetchV1 = vi.fn();
mocks.setAgentTokenV1 = vi.fn();
mocks.execute = vi.fn();

vi.mock('@metaplex-foundation/genesis', () => ({
  createAndRegisterLaunch: (...args: unknown[]) => mocks.createAndRegisterLaunch(...args),
  createLaunch: (...args: unknown[]) => mocks.createLaunch(...args),
  registerLaunch: (...args: unknown[]) => mocks.registerLaunch(...args),
  signAndSendLaunchTransactions: (...args: unknown[]) => mocks.signAndSend(...args),
}));

vi.mock('@metaplex-foundation/mpl-agent-registry', () => ({
  safeFetchAgentIdentityV2FromSeeds: (...args: unknown[]) => mocks.safeFetchV2(...args),
  safeFetchAgentIdentityV1FromSeeds: (...args: unknown[]) => mocks.safeFetchV1(...args),
  fetchAgentIdentityV2FromSeeds: (...args: unknown[]) => mocks.safeFetchV2(...args),
  fetchAgentIdentityV1FromSeeds: (...args: unknown[]) => mocks.safeFetchV1(...args),
  setAgentTokenV1: (...args: unknown[]) => mocks.setAgentTokenV1(...args),
}));

const FAKE_TREASURY = publicKey('11111111111111111111111111111112');
vi.mock('@metaplex-foundation/mpl-core', () => ({
  findAssetSignerPda: () => [FAKE_TREASURY, 255],
  execute: (...args: unknown[]) => mocks.execute(...args),
}));

// Import after mocks so the module sees them.
import {
  launchAgentToken,
  getAgentToken,
  hasAgentToken,
  isGenesisTokenImageUrl,
} from '../src/agent-token.js';

const FAKE_AGENT = '4Nd1m4mq6n3Wzx2gWVjUXjK1J4tRzuq8ASZxUgRJ6CcS';
const FAKE_IDENTITY_WALLET = publicKey('Sysvar1nstructions1111111111111111111111111');

function fakeUmi(): Umi {
  return {
    identity: { publicKey: FAKE_IDENTITY_WALLET },
    payer: { publicKey: FAKE_IDENTITY_WALLET },
    eddsa: {} as Umi['eddsa'],
    programs: {} as Umi['programs'],
    rpc: {} as Umi['rpc'],
    transactions: {} as Umi['transactions'],
    serializer: {} as Umi['serializer'],
    use: vi.fn(),
  } as unknown as Umi;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isGenesisTokenImageUrl', () => {
  it('accepts the Metaplex-validated HTTPS gateway prefix', () => {
    expect(isGenesisTokenImageUrl('https://gateway.irys.xyz/abc')).toBe(true);
    expect(isGenesisTokenImageUrl('  https://gateway.irys.xyz/x  ')).toBe(true);
  });
  it('rejects other hosts', () => {
    expect(isGenesisTokenImageUrl('https://example.com/logo.png')).toBe(false);
    expect(isGenesisTokenImageUrl('')).toBe(false);
  });
});

describe('launchAgentToken', () => {
  it('forwards token + agent fields to Genesis with sensible defaults', async () => {
    mocks.createAndRegisterLaunch.mockResolvedValueOnce({
      mintAddress: 'MintAddr111',
      genesisAccount: 'GenAcct111',
      signatures: [new Uint8Array(64).fill(1)],
      launch: { id: 'launch_1', link: 'https://www.metaplex.com/launches/1' },
      token: { id: 'token_1', mintAddress: 'MintAddr111' },
    });

    const result = await launchAgentToken(fakeUmi(), {
      agentAsset: FAKE_AGENT,
      token: {
        name: 'Plexpert',
        symbol: 'PLX',
        image: 'https://cdn.example.com/agent-token.png',
      },
    });

    expect(mocks.createAndRegisterLaunch).toHaveBeenCalledTimes(1);
    const [umiArg, configArg, inputArg] = mocks.createAndRegisterLaunch.mock.calls[0];
    expect(umiArg).toBeTruthy();
    expect(configArg).toBeNull();
    expect(inputArg).toMatchObject({
      wallet: FAKE_IDENTITY_WALLET,
      network: 'solana-devnet',
      launchType: 'bondingCurve',
      token: { name: 'Plexpert', symbol: 'PLX' },
      launch: {},
      agent: { mint: publicKey(FAKE_AGENT), setToken: false },
    });

    expect(result.mintAddress).toBe('MintAddr111');
    expect(result.genesisAccount).toBe('GenAcct111');
    expect(result.signatures).toHaveLength(1);
    expect(typeof result.signatures[0]).toBe('string');
    expect(result.agentTokenSet).toBe(false);
    expect(result.network).toBe('solana-devnet');
    expect(result.agentAsset).toBe(FAKE_AGENT);
  });

  it('passes setToken: true and firstBuyAmount through to Genesis', async () => {
    mocks.createAndRegisterLaunch.mockResolvedValueOnce({
      mintAddress: 'MintAddrXY',
      genesisAccount: 'GenAcctXY',
      signatures: [],
      launch: { id: 'launch_2', link: 'https://www.metaplex.com/launches/2' },
      token: { id: 'token_2', mintAddress: 'MintAddrXY' },
    });

    const result = await launchAgentToken(fakeUmi(), {
      agentAsset: FAKE_AGENT,
      token: {
        name: 'Locked-In Token',
        symbol: 'LCK',
        image: 'https://cdn.example.com/locked-token.png',
      },
      network: 'solana-mainnet',
      setToken: true,
      launch: { firstBuyAmount: 0.05 },
    });

    const inputArg = mocks.createAndRegisterLaunch.mock.calls[0]![2] as Record<string, unknown> & {
      agent: { setToken: boolean };
      launch: { firstBuyAmount: number };
      network: string;
    };
    expect(inputArg.network).toBe('solana-mainnet');
    expect(inputArg.agent.setToken).toBe(true);
    expect(inputArg.launch.firstBuyAmount).toBe(0.05);
    expect(result.agentTokenSet).toBe(true);
    expect(result.network).toBe('solana-mainnet');
  });

  it('rejects when Genesis throws (validation propagates)', async () => {
    mocks.createAndRegisterLaunch.mockRejectedValueOnce(
      Object.assign(new Error('Invalid token image URL'), { name: 'GenesisValidationError' }),
    );

    await expect(
      launchAgentToken(fakeUmi(), {
        agentAsset: FAKE_AGENT,
        token: { name: 'Bad', symbol: 'BAD', image: 'https://example.com/x.png' },
      }),
    ).rejects.toThrow(/Invalid token image URL/);
  });
});

describe('getAgentToken', () => {
  it('returns hasToken=true when AgentIdentityV2 has Some(agentToken)', async () => {
    mocks.safeFetchV2.mockResolvedValueOnce({
      asset: publicKey(FAKE_AGENT),
      agentToken: {
        __option: 'Some',
        value: publicKey('11111111111111111111111111111113') as unknown as PublicKey,
      },
    });

    const status = await getAgentToken(fakeUmi(), FAKE_AGENT);
    expect(status.hasToken).toBe(true);
    expect(status.mint).toBe('11111111111111111111111111111113');
    expect(status.source).toBe('v2');
    expect(status.treasury).toBe(String(FAKE_TREASURY));
  });

  it('returns hasToken=false when AgentIdentityV2 has None', async () => {
    mocks.safeFetchV2.mockResolvedValueOnce({
      asset: publicKey(FAKE_AGENT),
      agentToken: { __option: 'None' },
    });

    const status = await getAgentToken(fakeUmi(), FAKE_AGENT);
    expect(status.hasToken).toBe(false);
    expect(status.mint).toBeNull();
    expect(status.source).toBe('v2');
  });

  it('falls back to V1 (always hasToken=false) when V2 is missing', async () => {
    mocks.safeFetchV2.mockResolvedValueOnce(null);
    mocks.safeFetchV1.mockResolvedValueOnce({ asset: publicKey(FAKE_AGENT) });

    const status = await getAgentToken(fakeUmi(), FAKE_AGENT);
    expect(status.source).toBe('v1');
    expect(status.hasToken).toBe(false);
    expect(status.mint).toBeNull();
  });

  it('returns source=none when neither identity exists', async () => {
    mocks.safeFetchV2.mockResolvedValueOnce(null);
    mocks.safeFetchV1.mockResolvedValueOnce(null);

    const status = await getAgentToken(fakeUmi(), FAKE_AGENT);
    expect(status.source).toBe('none');
    expect(status.hasToken).toBe(false);
  });

  it('hasAgentToken is a boolean shortcut around getAgentToken', async () => {
    mocks.safeFetchV2.mockResolvedValueOnce({
      asset: publicKey(FAKE_AGENT),
      agentToken: { __option: 'Some', value: publicKey('11111111111111111111111111111113') },
    });
    expect(await hasAgentToken(fakeUmi(), FAKE_AGENT)).toBe(true);

    mocks.safeFetchV2.mockResolvedValueOnce({
      asset: publicKey(FAKE_AGENT),
      agentToken: { __option: 'None' },
    });
    expect(await hasAgentToken(fakeUmi(), FAKE_AGENT)).toBe(false);
  });
});
