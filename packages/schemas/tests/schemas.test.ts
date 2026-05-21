import { describe, expect, it } from 'vitest';
import {
  LeashBlockV1Schema,
  ReceiptV1Schema,
  RegistrationV1Schema,
  RulesV1Schema,
  IdentityDisclosureReadSchema,
  IdentityVerificationDecisionSchema,
  PublicIdentityProfileSchema,
  inferCapabilities,
} from '../src/index.js';

const validRules = {
  v: '0.1' as const,
  budget: { daily: '1', perCall: '0.01', currency: 'USDC' },
  hosts: { allow: ['example.com'] },
  triggers: [{ type: 'interval' as const, seconds: 30 }],
};

const validLeash = {
  v: '0.1' as const,
  rulesUri: 'ipfs://bafybeig',
  receiptsFeed: 'https://leash.app/a/mint/receipts.jsonl',
};

const validReceiptSpend = {
  v: '0.1' as const,
  kind: 'spend' as const,
  agent: 'AssetMint1111111111111111111111111111111',
  nonce: 0,
  ts: new Date().toISOString(),
  policy_v: '0.1',
  request: { method: 'GET', url: 'https://example.com', body_hash: null },
  decision: 'allow' as const,
  reason: null,
  price: {
    amount: '0.001',
    currency: 'USDC',
    network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  },
  facilitator: 'https://facilitator.svmacc.tech',
  tx_sig: 'sig123',
  response: { status: 200, body_hash: null },
  prev_receipt_hash: null,
  receipt_hash: 'abc',
};

describe('RulesV1Schema', () => {
  it('parses valid rules', () => {
    expect(() => RulesV1Schema.parse(validRules)).not.toThrow();
  });
  it('rejects wrong version', () => {
    expect(() => RulesV1Schema.parse({ ...validRules, v: '0.2' })).toThrow();
  });
  it('rejects missing budget', () => {
    expect(() => RulesV1Schema.parse({ ...validRules, budget: undefined })).toThrow();
  });
  it('rejects invalid trigger', () => {
    expect(() =>
      RulesV1Schema.parse({
        ...validRules,
        triggers: [{ type: 'interval', seconds: -1 }],
      }),
    ).toThrow();
  });
});

describe('LeashBlockV1Schema', () => {
  it('parses valid leash block', () => {
    expect(LeashBlockV1Schema.parse(validLeash)).toMatchObject(validLeash);
  });
  it('rejects bad receiptsFeed', () => {
    expect(() => LeashBlockV1Schema.parse({ ...validLeash, receiptsFeed: 'not-a-url' })).toThrow();
  });
});

describe('ReceiptV1Schema', () => {
  it('parses spend receipt', () => {
    expect(ReceiptV1Schema.parse(validReceiptSpend)).toMatchObject({ kind: 'spend' });
  });
  it('defaults kind to spend', () => {
    const { kind, ...rest } = validReceiptSpend;
    const parsed = ReceiptV1Schema.parse(rest);
    expect(parsed.kind).toBe('spend');
  });
  it('parses earn receipt', () => {
    const r = { ...validReceiptSpend, kind: 'earn' as const, nonce: 1 };
    expect(ReceiptV1Schema.parse(r).kind).toBe('earn');
  });
  it('rejects negative nonce', () => {
    expect(() => ReceiptV1Schema.parse({ ...validReceiptSpend, nonce: -1 })).toThrow();
  });
});

describe('RegistrationV1Schema', () => {
  const reg = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Agent',
    description: 'Test',
    image: 'https://example.com/i.png',
    services: [{ name: 'web', endpoint: 'https://example.com' }],
    leash: validLeash,
  };
  it('parses with leash', () => {
    expect(() => RegistrationV1Schema.parse(reg)).not.toThrow();
  });
  it('rejects invalid leash nested', () => {
    expect(() =>
      RegistrationV1Schema.parse({
        ...reg,
        leash: { ...validLeash, v: '0.2' },
      }),
    ).toThrow();
  });
});

describe('inferCapabilities', () => {
  it('detects buyer from leash', () => {
    const doc = RegistrationV1Schema.parse({
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'A',
      description: 'D',
      image: 'https://i',
      leash: validLeash,
    });
    expect(inferCapabilities(doc)).toContain('buyer');
  });
});

describe('Identity schemas', () => {
  const profile = {
    mint: 'Agnt...',
    network: 'solana-devnet' as const,
    handle: 'payce-demo',
    name: 'Payce Demo',
    description: 'Demo agent',
    image_url: null,
    treasury: 'Treasury...',
    services: [{ name: 'api', endpoint: 'https://api.example.com' }],
    verified_domains: ['agent.example'],
    capability_cards: [
      {
        id: 'cap_1',
        kind: 'seller_api' as const,
        title: 'Quote API',
        tags: ['quotes'],
        protocols: ['x402' as const],
        visibility: 'public' as const,
      },
    ],
    claims: [
      {
        id: 'claim_1',
        issuer: 'leash',
        subject_mint: 'Agnt...',
        type: 'domain-control',
        value: 'agent.example',
        evidence_url: null,
        signature: 'sig',
        visibility: 'public' as const,
        expires_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
      },
    ],
    operator_history: [
      {
        event_id: 'evt_1',
        kind: 'delegation_set' as const,
        phase: 'confirmed' as const,
        actor: null,
        delegate: 'Delegate...',
        executive: null,
        token_mint: 'USDC...',
        source_token_account: 'Ata...',
        delegated_amount: '250000',
        signature: 'tx',
        event_source: 'api',
        created_at: new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        failed_at: null,
      },
    ],
    reputation: { settled_calls: 1, denied_calls: 0, rating: 1 },
  };

  it('parses public identity profiles', () => {
    expect(PublicIdentityProfileSchema.parse(profile).capability_cards[0]?.kind).toBe('seller_api');
  });

  it('parses trust verdict decisions', () => {
    expect(
      IdentityVerificationDecisionSchema.parse({
        verdict: 'allow',
        resolved_mint: profile.mint,
        network: profile.network,
        score: 100,
        checks: [{ name: 'selector_resolves', passed: true, severity: 'info', detail: 'ok' }],
        profile: {
          mint: profile.mint,
          network: profile.network,
          handle: profile.handle,
          name: profile.name,
          verified_domains: profile.verified_domains,
          reputation: profile.reputation,
          capability_cards_count: 1,
          claims_count: 1,
        },
      }).verdict,
    ).toBe('allow');
  });

  it('parses selective disclosure reads', () => {
    expect(
      IdentityDisclosureReadSchema.parse({
        id: 'disc_1',
        agent: {
          mint: profile.mint,
          network: profile.network,
          handle: profile.handle,
          name: profile.name,
        },
        expires_at: new Date(Date.now() + 1000).toISOString(),
        resources: {
          capability_cards: profile.capability_cards,
          claims: profile.claims,
          receipts: [{ receipt_hash: 'abc', kind: 'spend' }],
        },
      }).resources.claims,
    ).toHaveLength(1);
  });
});
