import { describe, expect, it } from 'vitest';

import {
  LEASH_TOOLS,
  decodeBase64Json,
  isLikelyBase58Address,
  jsonResult,
  lookupTokenBySymbolSafe,
  noAgentResult,
  type LeashHost,
} from '../src/index.js';

const echoHost: LeashHost = {
  agentMint: null,
  ownerWallet: null,
  network: 'solana-devnet',
  rpcUrl: 'https://api.devnet.solana.com',
  apiBaseUrl: 'http://localhost:8801',
  async createPaymentLink(args) {
    return jsonResult({ kind: 'echo:create_payment_link', args });
  },
  async pay(args) {
    return jsonResult({ kind: 'echo:pay', args });
  },
  async withdraw(args) {
    return jsonResult({ kind: 'echo:withdraw', args });
  },
  async checkTreasuryBalance(args) {
    return jsonResult({ kind: 'echo:balance', args });
  },
  async registerAgent(args) {
    return jsonResult({ kind: 'echo:register_agent', args });
  },
  async getIdentity(args) {
    return jsonResult({ kind: 'echo:get_identity', args });
  },
  async receipts(args) {
    return jsonResult({ kind: 'echo:receipts', args });
  },
};

describe('LEASH_TOOLS', () => {
  it('exposes the seven canonical tools in stable order', () => {
    expect(LEASH_TOOLS.map((t) => t.name)).toEqual([
      'leash_check_treasury_balance',
      'leash_create_payment_link',
      'leash_get_identity',
      'leash_pay_payment_link',
      'leash_receipts',
      'leash_register_agent',
      'leash_withdraw_treasury',
    ]);
  });

  it('handlers route to the host implementation', async () => {
    const tool = LEASH_TOOLS.find((t) => t.name === 'leash_create_payment_link')!;
    const result = await tool.handler(
      {
        amount: 5,
        currency: 'USDC' as const,
        label: 'demo',
      },
      echoHost,
    );
    const parsed = JSON.parse(result.content[0]!.text) as {
      kind: string;
      args: { label: string };
    };
    expect(parsed.kind).toBe('echo:create_payment_link');
    expect(parsed.args.label).toBe('demo');
  });

  it('every tool has a non-empty description and a Zod input schema', () => {
    for (const t of LEASH_TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema).toBeDefined();
      expect(typeof (t.inputSchema as { parse?: unknown }).parse).toBe('function');
    }
  });
});

describe('helpers', () => {
  it('isLikelyBase58Address rejects whitespace and confusables', () => {
    expect(isLikelyBase58Address('11111111111111111111111111111111')).toBe(true);
    expect(isLikelyBase58Address(' 1111111111111111111111111111111 ')).toBe(false);
    expect(isLikelyBase58Address('0OIl')).toBe(false);
    expect(isLikelyBase58Address('short')).toBe(false);
  });

  it('lookupTokenBySymbolSafe finds devnet USDC + USDG and returns null for unknown', () => {
    const usdc = lookupTokenBySymbolSafe('usdc', 'devnet');
    expect(usdc?.mint).toBe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
    expect(usdc?.program).toBe('spl-token');

    const usdg = lookupTokenBySymbolSafe('USDG', 'devnet');
    expect(usdg?.program).toBe('spl-token-2022');

    expect(lookupTokenBySymbolSafe('XXX', 'devnet')).toBeNull();
  });

  it('decodeBase64Json round-trips a payload (with + without padding)', () => {
    const payload = { hello: 'world', n: 42 };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    expect(decodeBase64Json(encoded)).toEqual(payload);

    const trimmed = encoded.replace(/=+$/, '');
    expect(decodeBase64Json(trimmed)).toEqual(payload);
  });

  it('noAgentResult emits the expected discriminated kind', () => {
    const r = noAgentResult('payment_link');
    const parsed = JSON.parse(r.content[0]!.text) as { kind: string; status: string };
    expect(parsed.kind).toBe('payment_link');
    expect(parsed.status).toBe('no_agent');
  });
});
