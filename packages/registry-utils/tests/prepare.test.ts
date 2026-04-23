/**
 * Unit tests for the additive `prepare*` siblings of the registry-utils
 * helpers. Each test asserts two invariants:
 *
 *   1. The prepare function returns the correct echo fields + a
 *      transaction builder (or `null` for the "All" / "no-op" branches),
 *      mirroring the shape of the existing one-shot helpers without
 *      broadcasting anything.
 *   2. The legacy one-shot helper still works after the refactor: it
 *      delegates to its prepare sibling and submits the result via
 *      `sendAndConfirm`.
 *
 * Why a single consolidated file (rather than one test file per source
 * file)? The mock surface is shared (`mpl-core::execute`,
 * `mpl-toolbox::createIdempotentAssociatedToken`, `mpl-agent-registry::*`,
 * Umi RPC). Co-locating the mocks avoids duplicating the hoisted vi.mock
 * factories in 5 separate files.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { publicKey } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import type { Umi, PublicKey } from '@metaplex-foundation/umi';

const FAKE_TREASURY = publicKey('11111111111111111111111111111112');
const FAKE_AGENT = publicKey('11111111111111111111111111111113');
const FAKE_DEST = publicKey('11111111111111111111111111111114');
const FAKE_MINT = publicKey('11111111111111111111111111111115');
const FAKE_EXECUTIVE = publicKey('11111111111111111111111111111116');
const FAKE_COLLECTION = publicKey('11111111111111111111111111111117');
const FAKE_GENESIS = publicKey('11111111111111111111111111111118');
const FAKE_AGENT_IDENTITY = publicKey('11111111111111111111111111111119');
const FAKE_EXECUTIVE_PROFILE = publicKey('1111111111111111111111111111111A');
const FAKE_DELEGATE_RECORD = publicKey('1111111111111111111111111111111B');
const FAKE_ATA = publicKey('1111111111111111111111111111111C');
const FAKE_DEST2 = publicKey('1111111111111111111111111111111D');

// Shared mock spies wired through vi.hoisted so the vi.mock factories
// (which Vitest hoists to the top of the file) can reference them.
const mocks = vi.hoisted(() => ({
  execute: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  createIdempotentAssociatedToken: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  registerExecutiveV1: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  delegateExecutionV1: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  registerIdentityV1: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  setAgentTokenV1: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
  // Holds the next account state to return from umi.rpc.getAccount —
  // tests configure this per case to drive the prepare helpers' RPC
  // pre-flights.
  getAccount: (() => undefined) as unknown as ReturnType<typeof vi.fn>,
}));

mocks.execute = vi.fn();
mocks.createIdempotentAssociatedToken = vi.fn();
mocks.registerExecutiveV1 = vi.fn();
mocks.delegateExecutionV1 = vi.fn();
mocks.registerIdentityV1 = vi.fn();
mocks.setAgentTokenV1 = vi.fn();
mocks.getAccount = vi.fn();

vi.mock('@metaplex-foundation/mpl-core', () => ({
  findAssetSignerPda: () => [FAKE_TREASURY, 255],
  execute: (...args: unknown[]) => mocks.execute(...args),
}));

vi.mock('@metaplex-foundation/mpl-toolbox', () => ({
  findAssociatedTokenPda: () => [FAKE_ATA, 255],
  createIdempotentAssociatedToken: (...args: unknown[]) =>
    mocks.createIdempotentAssociatedToken(...args),
}));

vi.mock('@metaplex-foundation/mpl-agent-registry', () => ({
  registerExecutiveV1: (...args: unknown[]) => mocks.registerExecutiveV1(...args),
  delegateExecutionV1: (...args: unknown[]) => mocks.delegateExecutionV1(...args),
  registerIdentityV1: (...args: unknown[]) => mocks.registerIdentityV1(...args),
  setAgentTokenV1: (...args: unknown[]) => mocks.setAgentTokenV1(...args),
  findAgentIdentityV1Pda: () => [FAKE_AGENT_IDENTITY, 255],
  findExecutiveProfileV1Pda: () => [FAKE_EXECUTIVE_PROFILE, 255],
  findExecutionDelegateRecordV1Pda: () => [FAKE_DELEGATE_RECORD, 255],
  safeFetchExecutiveProfileV1FromSeeds: vi.fn(),
  safeFetchAgentIdentityV1FromSeeds: vi.fn(),
  safeFetchAgentIdentityV2FromSeeds: vi.fn(),
}));

import {
  prepareWithdrawTreasury,
  prepareWithdrawTreasuryAll,
  withdrawTreasury,
} from '../src/withdraw.js';
import {
  prepareSetSpendDelegation,
  prepareRevokeSpendDelegation,
  prepareProvisionTreasuryAtas,
  setSpendDelegation,
  revokeSpendDelegation,
  provisionTreasuryAtas,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from '../src/delegation.js';
import {
  prepareDelegateExecution,
  prepareRegisterExecutive,
  delegateExecution,
  registerExecutive,
} from '../src/executive.js';
import { prepareRegisterAgentIdentity, registerAgentIdentity } from '../src/register-identity.js';
import { prepareSetAgentToken, setAgentToken } from '../src/agent-token.js';

/**
 * Build a Umi double whose only RPC method is `getAccount`. Each test
 * is responsible for configuring `mocks.getAccount` (typically via
 * `mockResolvedValueOnce`) so we never silently reuse defaults across
 * tests.
 */
function makeUmi(): Umi {
  return {
    identity: { publicKey: FAKE_AGENT },
    payer: { publicKey: FAKE_AGENT },
    rpc: {
      getAccount: (...args: unknown[]) => mocks.getAccount(...args),
    },
  } as unknown as Umi;
}

/** 32-byte big-endian buffer for a PublicKey, padded/truncated as base58 dictates. */
function pkBytes(pk: PublicKey): Uint8Array {
  return base58.serialize(String(pk));
}

/**
 * Build a 165-byte SPL Token account payload with mint + owner pubkeys
 * embedded at the canonical offsets so `inspectTokenAccount`'s
 * mint/owner equality checks pass.
 */
function tokenAccountPayload(args: {
  mint: PublicKey;
  owner: PublicKey;
  amount?: bigint;
}): Uint8Array {
  const data = new Uint8Array(165);
  data.set(pkBytes(args.mint), 0);
  data.set(pkBytes(args.owner), 32);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  dv.setBigUint64(64, args.amount ?? 0n, true);
  return data;
}

/** SPL Mint payload (45 bytes) with `decimals` at byte 44. */
function mintPayload(decimals: number): Uint8Array {
  const data = new Uint8Array(45);
  data[44] = decimals & 0xff;
  return data;
}

/**
 * Build a token-account RPC response that satisfies inspectTokenAccount
 * (correct owner program + matching mint+owner bytes inside the data).
 */
function existingAtaResponse(args: {
  mint: PublicKey;
  owner: PublicKey;
  amount?: bigint;
  programId?: PublicKey;
}) {
  return {
    exists: true,
    data: tokenAccountPayload({ mint: args.mint, owner: args.owner, amount: args.amount }),
    owner: args.programId ?? SPL_TOKEN_PROGRAM_ID,
  };
}

beforeEach(() => {
  // resetAllMocks (NOT clearAllMocks) clears both call history AND any
  // queued .mockReturnValueOnce / .mockResolvedValueOnce values — these
  // queues persist across tests under clearAllMocks, which would cause
  // earlier tests' return values to leak into later assertions.
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// withdraw.ts
// ---------------------------------------------------------------------------

describe('prepareWithdrawTreasury', () => {
  it('returns the unsigned builder + echo without broadcasting', async () => {
    const fakeBuilder = { sendAndConfirm: vi.fn() };
    mocks.execute.mockReturnValueOnce(fakeBuilder);
    // Destination ATA already exists → no CreateIdempotent prepended.
    mocks.getAccount.mockResolvedValueOnce({ exists: true, data: new Uint8Array(165) });

    const umi = makeUmi();
    const prepared = await prepareWithdrawTreasury(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      destination: FAKE_DEST,
      amount: 5_000_000n,
      decimals: 6,
    });

    expect(prepared.builder).toBe(fakeBuilder);
    expect(prepared.treasury).toBe(String(FAKE_TREASURY));
    expect(prepared.amount).toBe(5_000_000n);
    expect(prepared.destination).toBe(String(FAKE_DEST));
    expect(prepared.decimals).toBe(6);
    expect(prepared.willCreateDestinationAta).toBe(false);
    expect(fakeBuilder.sendAndConfirm).not.toHaveBeenCalled();
  });

  it('flips willCreateDestinationAta when the destination ATA is missing', async () => {
    const baseBuilder = { sendAndConfirm: vi.fn() };
    const createdBuilder = { add: vi.fn(), sendAndConfirm: vi.fn() };
    createdBuilder.add.mockReturnValue(createdBuilder);
    mocks.execute.mockReturnValueOnce(baseBuilder);
    mocks.createIdempotentAssociatedToken.mockReturnValueOnce(createdBuilder);
    mocks.getAccount.mockResolvedValueOnce({ exists: false });

    const umi = makeUmi();
    const prepared = await prepareWithdrawTreasury(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      destination: FAKE_DEST,
      amount: 1n,
      decimals: 6,
    });
    expect(prepared.willCreateDestinationAta).toBe(true);
    expect(mocks.createIdempotentAssociatedToken).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-positive amount before reaching execute', async () => {
    const umi = makeUmi();
    await expect(
      prepareWithdrawTreasury(umi, {
        agentAsset: FAKE_AGENT,
        mint: FAKE_MINT,
        destination: FAKE_DEST,
        amount: 0n,
        decimals: 6,
      }),
    ).rejects.toThrow(/positive/);
  });

  it('looks up mint decimals via RPC when not provided', async () => {
    const builder = { sendAndConfirm: vi.fn() };
    mocks.execute.mockReturnValueOnce(builder);
    // First getAccount = mint decimals lookup. Second = destination ATA.
    mocks.getAccount
      .mockResolvedValueOnce({ exists: true, data: mintPayload(9) })
      .mockResolvedValueOnce({ exists: true, data: new Uint8Array(165) });
    const umi = makeUmi();
    const prepared = await prepareWithdrawTreasury(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      destination: FAKE_DEST,
      amount: 1n,
    });
    expect(prepared.decimals).toBe(9);
  });
});

describe('prepareWithdrawTreasuryAll', () => {
  it('returns null when the treasury ATA is uninitialised', async () => {
    mocks.getAccount.mockResolvedValueOnce({ exists: false });
    const umi = makeUmi();
    const prepared = await prepareWithdrawTreasuryAll(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      destination: FAKE_DEST,
      decimals: 6,
    });
    expect(prepared).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('returns null when balance is zero', async () => {
    mocks.getAccount.mockResolvedValueOnce(
      existingAtaResponse({ mint: FAKE_MINT, owner: FAKE_TREASURY, amount: 0n }),
    );
    const umi = makeUmi();
    const prepared = await prepareWithdrawTreasuryAll(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      destination: FAKE_DEST,
      decimals: 6,
    });
    expect(prepared).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('returns a prepared transfer when balance is non-zero', async () => {
    const builder = { sendAndConfirm: vi.fn() };
    mocks.execute.mockReturnValueOnce(builder);
    mocks.getAccount
      // Source ATA balance read.
      .mockResolvedValueOnce(
        existingAtaResponse({ mint: FAKE_MINT, owner: FAKE_TREASURY, amount: 7n }),
      )
      // Destination ATA existence check (exists → no CreateIdempotent).
      .mockResolvedValueOnce({ exists: true, data: new Uint8Array(165) });

    const umi = makeUmi();
    const prepared = await prepareWithdrawTreasuryAll(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      destination: FAKE_DEST,
      decimals: 6,
    });
    expect(prepared).not.toBeNull();
    expect(prepared!.amount).toBe(7n);
    expect(prepared!.builder).toBe(builder);
  });
});

describe('withdrawTreasury (legacy wrapper)', () => {
  it('delegates to prepare and calls sendAndConfirm', async () => {
    const builder = {
      sendAndConfirm: vi.fn().mockResolvedValueOnce({ signature: new Uint8Array(64) }),
    };
    mocks.execute.mockReturnValueOnce(builder);
    mocks.getAccount.mockResolvedValueOnce({ exists: true, data: new Uint8Array(165) });
    const umi = makeUmi();
    const result = await withdrawTreasury(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      destination: FAKE_DEST,
      amount: 100n,
      decimals: 6,
    });
    expect(builder.sendAndConfirm).toHaveBeenCalledTimes(1);
    expect(result.amount).toBe(100n);
    expect(result.treasury).toBe(String(FAKE_TREASURY));
  });
});

// ---------------------------------------------------------------------------
// delegation.ts
// ---------------------------------------------------------------------------

describe('prepareSetSpendDelegation', () => {
  it('returns builder + echo and skips CreateIdempotent when ATA exists', async () => {
    const builder = { sendAndConfirm: vi.fn() };
    mocks.execute.mockReturnValueOnce(builder);
    mocks.getAccount.mockResolvedValueOnce(
      existingAtaResponse({ mint: FAKE_MINT, owner: FAKE_TREASURY }),
    );

    const umi = makeUmi();
    const prepared = await prepareSetSpendDelegation(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      executive: FAKE_EXECUTIVE,
      amount: 5_000_000n,
    });
    expect(prepared.builder).toBe(builder);
    expect(prepared.willCreateAta).toBe(false);
    expect(prepared.delegate).toBe(String(FAKE_EXECUTIVE));
    expect(prepared.delegatedAmount).toBe(5_000_000n);
    expect(mocks.createIdempotentAssociatedToken).not.toHaveBeenCalled();
  });

  it('prepends CreateIdempotent when ATA is missing', async () => {
    const baseBuilder = { sendAndConfirm: vi.fn() };
    const createBuilder = { add: vi.fn(), sendAndConfirm: vi.fn() };
    createBuilder.add.mockReturnValue(createBuilder);
    mocks.execute.mockReturnValueOnce(baseBuilder);
    mocks.createIdempotentAssociatedToken.mockReturnValueOnce(createBuilder);
    mocks.getAccount.mockResolvedValueOnce({ exists: false });

    const umi = makeUmi();
    const prepared = await prepareSetSpendDelegation(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      executive: FAKE_EXECUTIVE,
      amount: 1n,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    });
    expect(prepared.willCreateAta).toBe(true);
    expect(mocks.createIdempotentAssociatedToken).toHaveBeenCalledTimes(1);
    expect(prepared.builder).toBe(createBuilder);
  });

  it('legacy setSpendDelegation still calls sendAndConfirm', async () => {
    const builder = {
      sendAndConfirm: vi.fn().mockResolvedValueOnce({ signature: new Uint8Array(64) }),
    };
    mocks.execute.mockReturnValueOnce(builder);
    mocks.getAccount.mockResolvedValueOnce(
      existingAtaResponse({ mint: FAKE_MINT, owner: FAKE_TREASURY }),
    );
    const umi = makeUmi();
    const r = await setSpendDelegation(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
      executive: FAKE_EXECUTIVE,
      amount: 7n,
    });
    expect(builder.sendAndConfirm).toHaveBeenCalledTimes(1);
    expect(r.delegatedAmount).toBe(7n);
  });
});

describe('prepareRevokeSpendDelegation', () => {
  it('returns the builder + echo without sending', () => {
    const builder = { sendAndConfirm: vi.fn() };
    mocks.execute.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const prepared = prepareRevokeSpendDelegation(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
    });
    expect(prepared.builder).toBe(builder);
    expect(prepared.treasury).toBe(String(FAKE_TREASURY));
    expect(builder.sendAndConfirm).not.toHaveBeenCalled();
  });

  it('legacy revokeSpendDelegation broadcasts the prepared tx', async () => {
    const builder = {
      sendAndConfirm: vi.fn().mockResolvedValueOnce({ signature: new Uint8Array(64) }),
    };
    mocks.execute.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const r = await revokeSpendDelegation(umi, {
      agentAsset: FAKE_AGENT,
      mint: FAKE_MINT,
    });
    expect(builder.sendAndConfirm).toHaveBeenCalledTimes(1);
    expect(r.treasury).toBe(String(FAKE_TREASURY));
  });
});

describe('prepareProvisionTreasuryAtas', () => {
  it('returns builder=null when every ATA already exists', async () => {
    mocks.getAccount.mockResolvedValueOnce(
      existingAtaResponse({ mint: FAKE_MINT, owner: FAKE_TREASURY }),
    );
    const umi = makeUmi();
    const prepared = await prepareProvisionTreasuryAtas(umi, {
      agentAsset: FAKE_AGENT,
      mints: [{ mint: FAKE_MINT, tokenProgram: SPL_TOKEN_PROGRAM_ID }],
    });
    expect(prepared.builder).toBeNull();
    expect(prepared.atas).toHaveLength(1);
    expect(prepared.atas[0]?.created).toBe(false);
  });

  it('returns a builder and flags missing ATAs as created=true', async () => {
    // First mint missing, second present.
    mocks.getAccount
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce(existingAtaResponse({ mint: FAKE_DEST2, owner: FAKE_TREASURY }));
    const builder1 = { add: vi.fn() };
    builder1.add.mockReturnValue(builder1);
    mocks.createIdempotentAssociatedToken.mockReturnValueOnce(builder1);
    const umi = makeUmi();
    const prepared = await prepareProvisionTreasuryAtas(umi, {
      agentAsset: FAKE_AGENT,
      mints: [
        { mint: FAKE_MINT, tokenProgram: SPL_TOKEN_PROGRAM_ID, symbol: 'A' },
        { mint: FAKE_DEST2, tokenProgram: SPL_TOKEN_PROGRAM_ID, symbol: 'B' },
      ],
    });
    expect(prepared.builder).not.toBeNull();
    expect(prepared.atas).toHaveLength(2);
    expect(prepared.atas[0]?.created).toBe(true);
    expect(prepared.atas[1]?.created).toBe(false);
  });

  it('legacy provisionTreasuryAtas returns the no-broadcast result when nothing missing', async () => {
    mocks.getAccount.mockResolvedValueOnce(
      existingAtaResponse({ mint: FAKE_MINT, owner: FAKE_TREASURY }),
    );
    const umi = makeUmi();
    const r = await provisionTreasuryAtas(umi, {
      agentAsset: FAKE_AGENT,
      mints: [{ mint: FAKE_MINT, tokenProgram: SPL_TOKEN_PROGRAM_ID }],
    });
    expect(r.atas).toHaveLength(1);
    expect(r.atas[0]?.created).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executive.ts
// ---------------------------------------------------------------------------

describe('prepareRegisterExecutive', () => {
  it('returns the builder + derived profile PDA without sending', async () => {
    const builder = { sendAndConfirm: vi.fn() };
    mocks.registerExecutiveV1.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const prepared = await prepareRegisterExecutive(umi);
    expect(prepared.builder).toBe(builder);
    expect(prepared.profile).toBe(String(FAKE_EXECUTIVE_PROFILE));
    expect(builder.sendAndConfirm).not.toHaveBeenCalled();
  });

  it('legacy registerExecutive still broadcasts', async () => {
    const builder = {
      sendAndConfirm: vi.fn().mockResolvedValueOnce({ signature: new Uint8Array(64) }),
    };
    mocks.registerExecutiveV1.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const r = await registerExecutive(umi);
    expect(builder.sendAndConfirm).toHaveBeenCalledTimes(1);
    expect(r.profile).toBe(String(FAKE_EXECUTIVE_PROFILE));
  });
});

describe('prepareDelegateExecution', () => {
  it('returns the builder + all derived PDAs without sending', async () => {
    const builder = { sendAndConfirm: vi.fn() };
    mocks.delegateExecutionV1.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const prepared = await prepareDelegateExecution(umi, {
      agentAsset: FAKE_AGENT,
      executiveAuthority: FAKE_EXECUTIVE,
    });
    expect(prepared.builder).toBe(builder);
    expect(prepared.delegateRecord).toBe(String(FAKE_DELEGATE_RECORD));
    expect(prepared.agentIdentity).toBe(String(FAKE_AGENT_IDENTITY));
    expect(prepared.executiveProfile).toBe(String(FAKE_EXECUTIVE_PROFILE));
    expect(builder.sendAndConfirm).not.toHaveBeenCalled();
  });

  it('legacy delegateExecution broadcasts the prepared builder', async () => {
    const builder = {
      sendAndConfirm: vi.fn().mockResolvedValueOnce({ signature: new Uint8Array(64) }),
    };
    mocks.delegateExecutionV1.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const r = await delegateExecution(umi, {
      agentAsset: FAKE_AGENT,
      executiveAuthority: FAKE_EXECUTIVE,
    });
    expect(builder.sendAndConfirm).toHaveBeenCalledTimes(1);
    expect(r.delegateRecord).toBe(String(FAKE_DELEGATE_RECORD));
  });
});

// ---------------------------------------------------------------------------
// register-identity.ts
// ---------------------------------------------------------------------------

describe('prepareRegisterAgentIdentity', () => {
  it('returns the builder + echo without sending', async () => {
    const builder = { sendAndConfirm: vi.fn() };
    mocks.registerIdentityV1.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const prepared = await prepareRegisterAgentIdentity(umi, {
      asset: FAKE_AGENT,
      collection: FAKE_COLLECTION,
      agentRegistrationUri: 'https://leash.dev/agent/abc.json',
    });
    expect(prepared.builder).toBe(builder);
    expect(prepared.asset).toBe(String(FAKE_AGENT));
    expect(prepared.collection).toBe(String(FAKE_COLLECTION));
    expect(prepared.agentRegistrationUri).toBe('https://leash.dev/agent/abc.json');
    expect(builder.sendAndConfirm).not.toHaveBeenCalled();
  });

  it('legacy registerAgentIdentity submits and returns a signature', async () => {
    const builder = {
      sendAndConfirm: vi.fn().mockResolvedValueOnce({ signature: new Uint8Array(64) }),
    };
    mocks.registerIdentityV1.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const r = await registerAgentIdentity(umi, {
      asset: FAKE_AGENT,
      collection: FAKE_COLLECTION,
      agentRegistrationUri: 'https://leash.dev/agent/abc.json',
    });
    expect(builder.sendAndConfirm).toHaveBeenCalledTimes(1);
    expect(typeof r.signature).toBe('string');
    expect(r.asset).toBe(String(FAKE_AGENT));
  });
});

// ---------------------------------------------------------------------------
// agent-token.ts (setAgentToken only — launchAgentToken already has a
// prepare/send split covered by the existing agent-token.test.ts file)
// ---------------------------------------------------------------------------

describe('prepareSetAgentToken', () => {
  it('returns the builder + echo without sending', async () => {
    const innerBuilder = { getInstructions: () => [] };
    mocks.setAgentTokenV1.mockReturnValueOnce(innerBuilder);
    const builder = { sendAndConfirm: vi.fn() };
    mocks.execute.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const prepared = await prepareSetAgentToken(umi, {
      agentAsset: FAKE_AGENT,
      genesisAccount: FAKE_GENESIS,
    });
    expect(prepared.builder).toBe(builder);
    expect(prepared.agentAsset).toBe(String(FAKE_AGENT));
    expect(prepared.genesisAccount).toBe(String(FAKE_GENESIS));
    expect(builder.sendAndConfirm).not.toHaveBeenCalled();
  });

  it('legacy setAgentToken broadcasts the prepared builder', async () => {
    const innerBuilder = { getInstructions: () => [] };
    mocks.setAgentTokenV1.mockReturnValueOnce(innerBuilder);
    const builder = {
      sendAndConfirm: vi.fn().mockResolvedValueOnce({ signature: new Uint8Array(64) }),
    };
    mocks.execute.mockReturnValueOnce(builder);
    const umi = makeUmi();
    const r = await setAgentToken(umi, {
      agentAsset: FAKE_AGENT,
      genesisAccount: FAKE_GENESIS,
    });
    expect(builder.sendAndConfirm).toHaveBeenCalledTimes(1);
    expect(r.agentAsset).toBe(String(FAKE_AGENT));
    expect(r.genesisAccount).toBe(String(FAKE_GENESIS));
  });
});
