import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { deriveAgentTreasuryAddress, listSplBalances } from '@leash/core';
import { listPlatformKeys } from '@leash/platform-auth';
import { z } from 'zod';

import { getDb } from '@/lib/db';
import { SOLANA_NETWORK, SOLANA_RPC, getServerEnv } from '@/lib/env';
import { getLeash } from '@/lib/leash';

export type LeashMcpContext = {
  privyId: string;
  agentMint?: string | null;
  ownerWallet?: string | null;
};

/**
 * In-process MCP tools for payment links, treasury pay, and marketplace calls.
 * Implementations are incremental — tools return structured JSON for the model and UI.
 */
export function createLeashMcpServer(ctx: LeashMcpContext): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'leash',
    version: '0.1.0',
    alwaysLoad: true,
    tools: [
      tool(
        'leash_create_payment_link',
        [
          'Create an x402 payment link the user can share to receive USDC/USDG/USDT.',
          'Requires an on-chain agent (treasury). Returns the public share URL on success — quote it back as a markdown link.',
        ].join(' '),
        {
          amount: z
            .number()
            .positive()
            .describe('Amount the buyer must pay. Use whole units (e.g. 20 for 20 USDC).'),
          currency: z
            .enum(['USDC', 'USDG', 'USDT'])
            .default('USDC')
            .describe('Stablecoin to charge in. Defaults to USDC.'),
          label: z
            .string()
            .min(1)
            .max(120)
            .describe('Human-readable label for the link (e.g. "Coffee — large").'),
          description: z.string().max(500).optional(),
        },
        async (args) => {
          if (!ctx.agentMint) {
            return jsonResult({
              kind: 'payment_link',
              status: 'no_agent',
              message:
                'No on-chain agent yet. Ask the user to mint one under Profile → Agent first.',
            });
          }
          try {
            const created = await createPaymentLinkOnBehalfOfUser({
              privyId: ctx.privyId,
              ownerAgent: ctx.agentMint,
              ownerWallet: ctx.ownerWallet ?? undefined,
              label: args.label,
              description: args.description,
              amount: args.amount,
              currency: args.currency,
            });
            return jsonResult({
              kind: 'payment_link',
              status: 'ok',
              id: created.id,
              url: created.share_url,
              price: `${args.amount} ${args.currency}`,
              currency: args.currency,
              label: args.label,
              network: created.network,
              owner_agent: created.owner_agent,
              note: 'Quote `url` back to the user as a markdown link in your reply.',
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'unknown error';
            return jsonResult({
              kind: 'payment_link',
              status: 'error',
              message: `Could not create payment link: ${message}`,
            });
          }
        },
      ),
      tool(
        'leash_pay_payment_link',
        'Pay an x402 payment link from the agent treasury (spend delegation).',
        {
          url: z.string().url(),
        },
        async (args) =>
          jsonResult({
            kind: 'pay',
            url: args.url,
            privy_id: ctx.privyId,
            agent_mint: ctx.agentMint ?? null,
            status: 'stub',
            message:
              'Buyer-kit + treasury resolution pending — surface delegation caps on /settings/spend when wired.',
          }),
      ),
      tool(
        'leash_check_treasury_balance',
        'Read the agent treasury balance — SOL plus every SPL token held (USDC, USDG, USDT pinned even when zero).',
        {
          symbol: z
            .string()
            .optional()
            .describe('Optional ticker filter — e.g. "USDC". When omitted, returns all balances.'),
        },
        async (args) => {
          if (!ctx.agentMint) {
            return jsonResult({
              kind: 'treasury_balance',
              status: 'no_agent',
              message:
                'No on-chain agent yet — ask the user to mint an agent under Profile → Agent.',
            });
          }
          try {
            const treasury = await deriveAgentTreasuryAddress(ctx.agentMint);
            const result = await listSplBalances({
              owner: String(treasury),
              rpcUrl: SOLANA_RPC,
              network: SOLANA_NETWORK === 'solana-mainnet' ? 'mainnet' : 'devnet',
              pinKnownStables: true,
            });
            const filtered = args.symbol
              ? result.tokens.filter(
                  (t) => (t.symbol ?? '').toLowerCase() === args.symbol!.toLowerCase(),
                )
              : result.tokens;
            return jsonResult({
              kind: 'treasury_balance',
              status: 'ok',
              treasury: String(treasury),
              network: SOLANA_NETWORK,
              sol: result.sol,
              tokens: filtered.map((t) => ({
                symbol: t.symbol,
                name: t.name,
                ui: t.ui,
                amount: t.amount,
                decimals: t.decimals,
                mint: t.mint,
                program: t.program,
              })),
            });
          } catch (e) {
            return jsonResult({
              kind: 'treasury_balance',
              status: 'error',
              message: e instanceof Error ? e.message : 'unknown',
            });
          }
        },
      ),
      tool(
        'leash_call_marketplace_tool',
        'Pay-then-call a favorited marketplace tool via Leash registry.',
        {
          slug: z.string(),
          args_json: z.string().optional().describe('JSON-encoded arguments object'),
        },
        async (args) =>
          jsonResult({
            kind: 'marketplace_tool',
            slug: args.slug,
            args_json: args.args_json ?? '{}',
            status: 'stub',
            message: 'Uses /api/marketplace-search + /api/manifest in a follow-up iteration.',
          }),
      ),
    ],
  });
}

function jsonResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

type CreatePaymentLinkArgs = {
  privyId: string;
  ownerAgent: string;
  ownerWallet?: string;
  label: string;
  description?: string;
  amount: number;
  currency: 'USDC' | 'USDG' | 'USDT';
};

type PaymentLinkResponseBody = {
  id: string;
  network: 'solana-devnet' | 'solana-mainnet';
  share_url: string;
  owner_agent: string;
};

/**
 * Resolve a usable plaintext API key for the signed-in user, then post to
 * `apps/api`'s `/v1/payment-links`. Falls back through the user's tracked
 * keys until one can be revealed (legacy hash-only keys are skipped).
 */
async function createPaymentLinkOnBehalfOfUser(
  args: CreatePaymentLinkArgs,
): Promise<PaymentLinkResponseBody> {
  const env = getServerEnv();
  const db = getDb();
  const platformKeys = await listPlatformKeys(db, args.privyId);

  if (platformKeys.length === 0) {
    throw new Error(
      'No API key on file for this account. Open Profile → API keys and create one (a default key is normally provisioned on first sign-in).',
    );
  }

  let plaintext: string | null = null;
  let lastError: string | null = null;
  for (const k of platformKeys) {
    try {
      plaintext = await getLeash().revealApiKey(k.keyId);
      if (plaintext) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'unknown';
    }
  }
  if (!plaintext) {
    throw new Error(
      `Could not access an API key plaintext (${lastError ?? 'no revealable keys'}). Re-issue a key from Profile → API keys.`,
    );
  }

  const body = {
    label: args.label,
    description: args.description,
    owner_agent: args.ownerAgent,
    ...(args.ownerWallet ? { owner_wallet: args.ownerWallet } : {}),
    method: 'GET',
    price: `${args.amount} ${args.currency}`,
    currency: args.currency,
    response: {
      status: 200,
      mimeType: 'application/json',
      body: { ok: true, label: args.label },
    },
  };

  const res = await fetch(`${env.leashApiUrl}/v1/payment-links`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${plaintext}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`apps/api ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as PaymentLinkResponseBody;
  return json;
}
