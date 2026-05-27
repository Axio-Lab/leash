import { generateSigner } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { describe, expect, it } from 'vitest';

import { buildSigningEnvelope } from '../src/auth/onchain.js';
import { createPlatformAgent } from '../src/storage/platform-agents.js';
import { getApiKeyById } from '../src/storage/api-keys.js';
import { createTestRig, type TestRig } from './helpers.js';

const umi = createUmi('https://invalid');

type TestSigner = {
  pubkey: string;
  secretKey: Uint8Array;
};

function freshSigner(): TestSigner {
  const signer = generateSigner(umi);
  const kp = umi.eddsa.createKeypairFromSecretKey(signer.secretKey);
  return { pubkey: kp.publicKey.toString(), secretKey: kp.secretKey };
}

async function insertAgent(
  rig: TestRig,
  args: { mint?: string; executive: TestSigner; network?: 'solana-devnet' | 'solana-mainnet' },
): Promise<string> {
  const mint = args.mint ?? freshSigner().pubkey;
  await createPlatformAgent(rig.db, {
    mint,
    ownerPrivyId: `privy:${mint.slice(0, 8)}`,
    ownerWallet: args.executive.pubkey,
    name: 'Test Agent',
    description: null,
    imageUrl: null,
    services: [],
    network: args.network ?? 'solana-devnet',
    model: 'test',
    systemPrompt: 'test',
    capabilities: [],
    budget: { perAction: '0.01', perTask: '0.10', perDay: '1.00' },
    treasury: freshSigner().pubkey,
    serviceKeyId: freshSigner().pubkey,
    encryptedLlmKey: 'test',
    llmProvider: 'platform',
  });
  return mint;
}

async function signedFetch(
  rig: TestRig,
  args: {
    mint: string;
    executive: TestSigner;
    path: string;
    method?: string;
    body?: unknown;
  },
): Promise<Response> {
  const method = args.method ?? 'GET';
  const body = args.body === undefined ? undefined : JSON.stringify(args.body);
  const timestamp = new Date().toISOString();
  const envelope = buildSigningEnvelope({
    method,
    pathWithQuery: args.path,
    timestamp,
    body,
    agentMint: args.mint,
  });
  const keypair = umi.eddsa.createKeypairFromSecretKey(args.executive.secretKey);
  const sig = umi.eddsa.sign(envelope, keypair);
  return rig.app.fetch(
    new Request(`http://test.local${args.path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-leash-agent': args.mint,
        'x-leash-timestamp': timestamp,
        'x-leash-sig': base58.deserialize(sig)[0],
      },
      body,
    }),
  );
}

describe('agent-created api keys', () => {
  it('creates an agent-scoped key owned by the executive public key', async () => {
    const rig = await createTestRig();
    const executive = freshSigner();
    const mint = await insertAgent(rig, { executive });

    const res = await signedFetch(rig, {
      mint,
      executive,
      path: `/v1/agents/${mint}/api-keys`,
      method: 'POST',
      body: { label: 'Agent runtime' },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      key: {
        id: string;
        label: string;
        network: string;
        owner_wallet: string;
        agent_mint: string;
        scopes: string[];
      };
      plaintext: string;
    };
    expect(body.plaintext).toMatch(/^lsh_test_/);
    expect(body.key.label).toBe('Agent runtime');
    expect(body.key.network).toBe('solana-devnet');
    expect(body.key.owner_wallet).toBe(executive.pubkey);
    expect(body.key.agent_mint).toBe(mint);
    expect(body.key.scopes).toEqual(['agent']);

    const stored = await getApiKeyById(rig.db, body.key.id);
    expect(stored?.ownerWallet).toBe(executive.pubkey);
    expect(stored?.agentMint).toBe(mint);
    expect(stored?.scopes).toEqual(['agent']);
  });

  it('rejects create without a valid X-Leash-Sig', async () => {
    const rig = await createTestRig();
    const executive = freshSigner();
    const mint = await insertAgent(rig, { executive });

    const res = await rig.app.fetch(
      new Request(`http://test.local/v1/agents/${mint}/api-keys`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: 'bad' }),
      }),
    );

    expect(res.status).toBe(401);
  });

  it('rejects when the signer is not the agent executive', async () => {
    const rig = await createTestRig();
    const executive = freshSigner();
    const wrongExecutive = freshSigner();
    const mint = await insertAgent(rig, { executive });

    const res = await signedFetch(rig, {
      mint,
      executive: wrongExecutive,
      path: `/v1/agents/${mint}/api-keys`,
      method: 'POST',
      body: { label: 'wrong' },
    });

    expect(res.status).toBe(401);
  });

  it('lists and revokes only the signing agent keys', async () => {
    const rig = await createTestRig();
    const executive = freshSigner();
    const firstMint = await insertAgent(rig, { executive });
    const secondMint = await insertAgent(rig, { executive });

    const createFirst = await signedFetch(rig, {
      mint: firstMint,
      executive,
      path: `/v1/agents/${firstMint}/api-keys`,
      method: 'POST',
      body: { label: 'first' },
    });
    const firstBody = (await createFirst.json()) as { key: { id: string } };

    const createSecond = await signedFetch(rig, {
      mint: secondMint,
      executive,
      path: `/v1/agents/${secondMint}/api-keys`,
      method: 'POST',
      body: { label: 'second' },
    });
    const secondBody = (await createSecond.json()) as { key: { id: string } };

    const listFirst = await signedFetch(rig, {
      mint: firstMint,
      executive,
      path: `/v1/agents/${firstMint}/api-keys`,
    });
    expect(listFirst.status).toBe(200);
    const listBody = (await listFirst.json()) as { items: Array<{ id: string }> };
    expect(listBody.items.map((item) => item.id)).toEqual([firstBody.key.id]);

    const crossRevoke = await signedFetch(rig, {
      mint: firstMint,
      executive,
      path: `/v1/agents/${firstMint}/api-keys/${secondBody.key.id}/disable`,
      method: 'POST',
    });
    expect(crossRevoke.status).toBe(404);

    const revoke = await signedFetch(rig, {
      mint: firstMint,
      executive,
      path: `/v1/agents/${firstMint}/api-keys/${firstBody.key.id}/disable`,
      method: 'POST',
    });
    expect(revoke.status).toBe(200);
    const after = await getApiKeyById(rig.db, firstBody.key.id);
    expect(after?.disabledAt).not.toBeNull();
  });
});
