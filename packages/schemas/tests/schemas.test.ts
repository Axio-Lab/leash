import { describe, expect, it } from 'vitest';
import {
  LeashBlockV1Schema,
  ReceiptV1Schema,
  RegistrationV1Schema,
  RulesV1Schema,
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
  price: { amount: '0.001', currency: 'USDC', network: 'solana:103' },
  facilitator: 'payai' as const,
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
