/**
 * Chat-product adapter for `@leash/mcp-core`.
 *
 * The shared tool definitions live in `@leash/mcp-core/tools` so the
 * standalone STDIO MCP server (`packages/mcp`) and CLI can use the
 * exact same `name`/`schema` set. This module is the runtime glue:
 *
 *   1. Build a chat-product `LeashHost` whose methods match the
 *      browser-in-the-loop semantics (artifacts the chat UI renders
 *      as Pay / Withdraw cards instead of in-process settlement).
 *   2. Wrap each shared `LeashTool` in the Claude Agent SDK's `tool()`
 *      so the in-process MCP server can be passed to `query()`.
 *
 * Adding a new tool means: drop the definition into
 * `@leash/mcp-core/tools` + implement the host method here.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { TOKEN_2022_PROGRAM_ID, deriveAgentTreasuryAddress, listSplBalances } from '@leash/core';
import { z } from 'zod';
import {
  LEASH_TOOLS,
  isLikelyBase58Address,
  jsonResult,
  lookupTokenBySymbolSafe,
  noAgentResult,
  probePaymentLink,
  type CheckTreasuryBalanceArgs,
  type CreatePaymentLinkArgs,
  type LeashHost,
  type LeashTool,
  type LeashToolResult,
  type PayArgs,
  type WithdrawArgs,
} from '@leash/mcp-core';
import { listPlatformKeys } from '@leash/platform-auth';

import { getDb } from '@/lib/db';
import { SOLANA_NETWORK, SOLANA_RPC, getServerEnv } from '@/lib/env';
import { getLeash } from '@/lib/leash';

export type LeashMcpContext = {
  privyId: string;
  agentMint?: string | null;
  ownerWallet?: string | null;
};

/**
 * Build the chat-product `LeashHost`. Captures the per-request
 * (`privyId`, `agentMint`, `ownerWallet`) context plus the static
 * server env once so the per-tool methods stay tight.
 */
function createChatHost(ctx: LeashMcpContext): LeashHost {
  const env = getServerEnv();
  return {
    agentMint: ctx.agentMint ?? null,
    ownerWallet: ctx.ownerWallet ?? null,
    network: SOLANA_NETWORK as LeashHost['network'],
    rpcUrl: SOLANA_RPC,
    apiBaseUrl: env.leashApiUrl,

    async createPaymentLink(args: CreatePaymentLinkArgs): Promise<LeashToolResult> {
      if (!ctx.agentMint) {
        return noAgentResult(
          'payment_link',
          'No on-chain agent yet. Ask the user to mint one under Profile → Agent first.',
        );
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

    async pay(args: PayArgs): Promise<LeashToolResult> {
      if (!ctx.agentMint) {
        return noAgentResult(
          'payment_request',
          'No on-chain agent yet — ask the user to mint one under Profile → Agent first.',
        );
      }
      try {
        const preview = await probePaymentLink(args.url);
        return jsonResult({
          kind: 'payment_request',
          status: 'ok',
          url: args.url,
          agent_mint: ctx.agentMint,
          preview,
          note: 'Reply with a single short sentence telling the user to review the Pay card below and click Approve & pay. Do NOT attempt to settle the payment yourself.',
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown error';
        return jsonResult({
          kind: 'payment_request',
          status: 'error',
          url: args.url,
          message: `Could not probe payment link: ${message}`,
        });
      }
    },

    async checkTreasuryBalance(args: CheckTreasuryBalanceArgs): Promise<LeashToolResult> {
      if (!ctx.agentMint) {
        return noAgentResult(
          'treasury_balance',
          'No on-chain agent yet — ask the user to mint an agent under Profile → Agent.',
        );
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

    async withdraw(args: WithdrawArgs): Promise<LeashToolResult> {
      if (!ctx.agentMint) {
        return noAgentResult(
          'withdraw_request',
          'No on-chain agent yet. Ask the user to mint one under Profile → Agent first.',
        );
      }
      if (!isLikelyBase58Address(args.destination)) {
        return jsonResult({
          kind: 'withdraw_request',
          status: 'error',
          message:
            'Destination does not look like a Solana wallet address (base58, 32–44 chars). Ask the user to confirm the address.',
        });
      }

      if (args.token === 'SOL') {
        const lamports = BigInt(Math.floor(args.amount * 1_000_000_000));
        if (lamports <= 0n) {
          return jsonResult({
            kind: 'withdraw_request',
            status: 'error',
            message: 'Amount rounds to zero lamports — request a larger amount.',
          });
        }
        return jsonResult({
          kind: 'withdraw_request',
          status: 'ok',
          agent_mint: ctx.agentMint,
          token: 'SOL',
          decimals: 9,
          amount: String(args.amount),
          amount_atomic: lamports.toString(),
          destination: args.destination,
          network: SOLANA_NETWORK,
          note: 'Reply with a single short sentence telling the user to review the Withdraw card below and click Approve & withdraw.',
        });
      }

      const tokenNetwork = SOLANA_NETWORK === 'solana-mainnet' ? 'mainnet' : 'devnet';
      const meta = lookupTokenBySymbolSafe(args.token, tokenNetwork);
      if (!meta) {
        return jsonResult({
          kind: 'withdraw_request',
          status: 'error',
          message: `Token ${args.token} is not catalogued on ${tokenNetwork}. Try USDC, USDG, or USDT.`,
        });
      }
      const atomic = BigInt(Math.floor(args.amount * 10 ** meta.decimals));
      if (atomic <= 0n) {
        return jsonResult({
          kind: 'withdraw_request',
          status: 'error',
          message: 'Amount rounds to zero atomic units — request a larger amount.',
        });
      }
      return jsonResult({
        kind: 'withdraw_request',
        status: 'ok',
        agent_mint: ctx.agentMint,
        token: meta.symbol,
        mint: meta.mint,
        token_program: meta.program === 'spl-token-2022' ? TOKEN_2022_PROGRAM_ID : null,
        decimals: meta.decimals,
        amount: String(args.amount),
        amount_atomic: atomic.toString(),
        destination: args.destination,
        network: SOLANA_NETWORK,
        note: 'Reply with a single short sentence telling the user to review the Withdraw card below and click Approve & withdraw.',
      });
    },
  };
}

/**
 * Adapt a shared `LeashTool` to the Claude Agent SDK's `tool()` shape.
 * `tool()` consumes the **shape** of the Zod schema (i.e. the bag of
 * fields), not the schema itself, so we pull out `.shape` from the
 * top-level `ZodObject` here.
 */
function adaptToClaudeTool(def: LeashTool, host: LeashHost) {
  // ZodObject exposes `.shape` as the field map; non-object schemas
  // aren't expected at the top level here.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shape = (def.inputSchema as any).shape ?? def.inputSchema;
  return tool(def.name, def.description, shape, async (args: unknown) => def.handler(args, host));
}

/**
 * In-process MCP tools for payment links, treasury pay, and marketplace calls.
 * Uses the shared `@leash/mcp-core` definitions so every Leash surface
 * (chat product, standalone STDIO MCP, CLI) exposes an identical tool
 * surface to the LLM.
 */
export function createLeashMcpServer(ctx: LeashMcpContext): McpSdkServerConfigWithInstance {
  const host = createChatHost(ctx);
  return createSdkMcpServer({
    name: 'leash',
    version: '0.1.0',
    alwaysLoad: true,
    tools: [
      ...LEASH_TOOLS.map((def) => adaptToClaudeTool(def, host)),
      // Marketplace-tool dispatch is still a stub — keep it scoped to
      // the chat surface until the standalone MCP can also call it.
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

type CreatePaymentLinkOnBehalfArgs = {
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
  args: CreatePaymentLinkOnBehalfArgs,
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
