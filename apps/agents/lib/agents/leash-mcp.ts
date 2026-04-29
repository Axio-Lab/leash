import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { deriveAgentTreasuryAddress, listSplBalances } from '@leash/core';
import { z } from 'zod';

import { SOLANA_NETWORK, SOLANA_RPC } from '@/lib/env';

export type LeashMcpContext = {
  privyId: string;
  agentMint?: string | null;
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
        'Create an x402 payment link. Requires an on-chain agent with treasury. Returns URL + metadata.',
        {
          amount_usdc: z.number().positive().describe('USDC amount'),
          memo: z.string().optional(),
        },
        async (args) => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                kind: 'payment_link',
                amount_usdc: args.amount_usdc,
                memo: args.memo ?? null,
                privy_id: ctx.privyId,
                agent_mint: ctx.agentMint ?? null,
                status: 'stub',
                message:
                  'Seller runtime wiring pending — return this JSON as a payment_link artifact in UI when integrated.',
              }),
            },
          ],
        }),
      ),
      tool(
        'leash_pay_payment_link',
        'Pay an x402 payment link from the agent treasury (spend delegation).',
        {
          url: z.string().url(),
        },
        async (args) => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                kind: 'pay',
                url: args.url,
                privy_id: ctx.privyId,
                agent_mint: ctx.agentMint ?? null,
                status: 'stub',
                message:
                  'Buyer-kit + treasury resolution pending — surface delegation caps on /settings/spend when wired.',
              }),
            },
          ],
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
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    kind: 'treasury_balance',
                    status: 'no_agent',
                    message:
                      'No on-chain agent yet — ask the user to mint an agent under Profile → Agent.',
                  }),
                },
              ],
            };
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
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
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
                  }),
                },
              ],
            };
          } catch (e) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    kind: 'treasury_balance',
                    status: 'error',
                    message: e instanceof Error ? e.message : 'unknown',
                  }),
                },
              ],
            };
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
        async (args) => ({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                kind: 'marketplace_tool',
                slug: args.slug,
                args_json: args.args_json ?? '{}',
                status: 'stub',
                message: 'Uses /api/marketplace-search + /api/manifest in a follow-up iteration.',
              }),
            },
          ],
        }),
      ),
    ],
  });
}
