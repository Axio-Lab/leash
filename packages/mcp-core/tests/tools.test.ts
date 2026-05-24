import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LEASH_TOOLS,
  decodeBase64Json,
  isLikelyBase58Address,
  jsonResult,
  lookupTokenBySymbolSafe,
  noAgentResult,
  probePaymentLink,
  symbolForMintSafe,
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
  async discover(args) {
    return jsonResult({ kind: 'echo:discover', args });
  },
  async reputation(args) {
    return jsonResult({ kind: 'echo:reputation', args });
  },
  async resolveIdentity(args) {
    return jsonResult({ kind: 'echo:resolve_identity', args });
  },
  async verifyIdentity(args) {
    return jsonResult({ kind: 'echo:verify_identity', args });
  },
  async paySkillsProvider(args) {
    return jsonResult({ kind: 'echo:pay_skills_provider', args });
  },
  async setSpendLimit(args) {
    return jsonResult({ kind: 'echo:set_spend_limit', args });
  },
  async getSpendLimit(args) {
    return jsonResult({ kind: 'echo:get_spend_limit', args });
  },
  async getReceipt(args) {
    return jsonResult({ kind: 'echo:get_receipt', args });
  },
  async transactionHistory(args) {
    return jsonResult({ kind: 'echo:transaction_history', args });
  },
  async dailyTransactions(args) {
    return jsonResult({ kind: 'echo:daily_transactions', args });
  },
};

describe('LEASH_TOOLS', () => {
  it('exposes the canonical tools in stable order', () => {
    expect(LEASH_TOOLS.map((t) => t.name)).toEqual([
      'leash_check_treasury_balance',
      'leash_create_payment_link',
      'leash_daily_transactions',
      'leash_discover',
      'leash_get_identity',
      'leash_get_receipt',
      'leash_get_spend_limit',
      'leash_pay_payment_link',
      'leash_pay_skills_endpoints',
      'leash_receipts',
      'leash_register_agent',
      'leash_reputation',
      'leash_resolve_identity',
      'leash_set_spend_limit',
      'leash_transaction_history',
      'leash_verify_identity',
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
        method: 'GET' as const,
        upstream_url: 'https://jsonplaceholder.typicode.com/posts',
      },
      echoHost,
    );
    const parsed = JSON.parse(result.content[0]!.text) as {
      kind: string;
      args: { label: string; method: string; upstream_url: string };
    };
    expect(parsed.kind).toBe('echo:create_payment_link');
    expect(parsed.args.label).toBe('demo');
    expect(parsed.args.method).toBe('GET');
    expect(parsed.args.upstream_url).toBe('https://jsonplaceholder.typicode.com/posts');
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

  it('symbolForMintSafe reverse-resolves catalogued mints', () => {
    expect(symbolForMintSafe('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 'devnet')).toBe(
      'USDC',
    );
    expect(symbolForMintSafe('4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7', 'devnet')).toBe(
      'USDG',
    );
    expect(symbolForMintSafe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'mainnet')).toBe(
      'USDC',
    );
    expect(symbolForMintSafe('not-a-mint', 'devnet')).toBeNull();
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

  describe('probePaymentLink', () => {
    const savedFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = savedFetch;
    });

    it('parses x402 payment-required header', async () => {
      const accepts = [
        {
          network: 'solana-devnet',
          payTo: 'Recv11111111111111111111111111111111',
          asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
          amount: '1000',
          currency: 'USDC',
        },
      ];
      const b64 = Buffer.from(JSON.stringify({ accepts })).toString('base64');
      globalThis.fetch = vi.fn(
        async () =>
          new Response('', {
            status: 402,
            headers: { 'payment-required': b64 },
          }),
      ) as typeof fetch;

      const p = await probePaymentLink('https://example.com/x/foo?network=solana-devnet');
      expect(p.protocol).toBe('x402');
      expect(p.pay_to).toBe('Recv11111111111111111111111111111111');
      expect(p.currency).toBe('USDC');
    });

    it('parses MPP problem+json', async () => {
      const body = {
        type: 'https://paymentauth.org/problems/payment-required',
        status: 402,
        challengeId: 'cid-1',
        request: {
          recipient: 'Recv11111111111111111111111111111111',
          amount: '1000',
          currency: 'USDC',
          network: 'solana-devnet',
          asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        },
      };
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status: 402,
            headers: { 'content-type': 'application/problem+json' },
          }),
      ) as typeof fetch;

      const p = await probePaymentLink('https://example.com/mpp');
      expect(p.protocol).toBe('mpp');
      expect(p.challenge_id).toBe('cid-1');
      expect(p.pay_to).toBe('Recv11111111111111111111111111111111');
    });
  });
});
