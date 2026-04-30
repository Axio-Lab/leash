import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { TOKEN_2022_PROGRAM_ID, deriveAgentTreasuryAddress, listSplBalances } from '@leash/core';
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
        [
          'Pay an x402 payment link from the agent treasury under the per-action / per-task / per-day caps.',
          'This tool DOES NOT settle on its own — the operator key lives in the user’s Privy wallet, not the server.',
          'Instead it probes the URL for a 402 quote and returns a `payment_request` artifact the chat UI renders as a "Pay" card.',
          'The user clicks "Approve & pay" once and the buyer-kit signs the SPL transfer in their browser using the spend delegation.',
          'Reply with one short sentence telling the user to confirm in the Pay card below.',
        ].join(' '),
        {
          url: z.string().url().describe('The full https://…/x/<id>?network=… payment link.'),
        },
        async (args) => {
          if (!ctx.agentMint) {
            return jsonResult({
              kind: 'payment_request',
              status: 'no_agent',
              message:
                'No on-chain agent yet — ask the user to mint one under Profile → Agent first.',
            });
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
        'leash_withdraw_treasury',
        [
          'Build an owner-driven withdrawal of SOL or an SPL stable (USDC/USDG/USDT) from the agent treasury to any Solana wallet.',
          'This tool DOES NOT settle on its own — only the asset owner (the connected Privy wallet) can sign the `mpl-core::Execute` instruction, and that key never leaves the browser.',
          'Instead it validates inputs, resolves mint + decimals, and returns a `withdraw_request` artifact the chat UI renders as a "Withdraw" card.',
          'On `status: "ok"`, reply with one short sentence asking the user to review the Withdraw card below and click "Approve & withdraw". Never claim the withdrawal completed and never invent a tx hash.',
          'On `status: "error"`, surface the `message` verbatim.',
        ].join(' '),
        {
          token: z
            .enum(['SOL', 'USDC', 'USDG', 'USDT'])
            .describe('Token to withdraw. SOL for native lamports; otherwise an SPL stable.'),
          amount: z
            .number()
            .positive()
            .describe(
              'Amount in whole units (e.g. 100 for 100 USDC, 0.5 for 0.5 SOL). Positive only.',
            ),
          destination: z
            .string()
            .min(32)
            .max(44)
            .describe(
              "Recipient Solana wallet address (base58). Must NOT be the treasury itself; it's the destination wallet, not its ATA.",
            ),
        },
        async (args) => {
          if (!ctx.agentMint) {
            return jsonResult({
              kind: 'withdraw_request',
              status: 'no_agent',
              message:
                'No on-chain agent yet. Ask the user to mint one under Profile → Agent first.',
            });
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

type PaymentRequirementPreview = {
  network: string;
  pay_to: string;
  asset: string;
  amount_atomic: string;
  currency: string;
  description?: string;
};

/**
 * GET the x402 paywall and decode its `payment-required` header into a
 * preview the UI can render before the user is asked to approve the
 * payment. We pick the first `accepts[]` entry on the URL's network so
 * the preview matches what the buyer-kit will actually attempt.
 *
 * Throws on unreachable URLs, non-402 responses, or malformed headers
 * so the caller can surface the message to the user.
 */
async function probePaymentLink(url: string): Promise<PaymentRequirementPreview> {
  const res = await fetch(url, { method: 'GET' });
  if (res.status !== 402) {
    throw new Error(`expected 402 from paywall, got HTTP ${res.status}`);
  }
  const header = res.headers.get('payment-required') ?? res.headers.get('PAYMENT-REQUIRED');
  if (!header) {
    throw new Error('seller did not send a `payment-required` header');
  }
  const decoded = decodeBase64Json(header) as {
    error?: string;
    accepts?: Array<{
      network?: string;
      payTo?: string;
      asset?: string;
      amount?: string;
      currency?: string;
      description?: string;
    }>;
  } | null;
  if (!decoded || !Array.isArray(decoded.accepts) || decoded.accepts.length === 0) {
    throw new Error(decoded?.error ?? 'malformed payment-required header');
  }
  // Prefer the first accepts entry that matches the URL's `?network=`
  // query (the paywall always picks one network per link, so this is
  // unambiguous). Fall back to accepts[0] if no match.
  const wantNetwork = (() => {
    try {
      const u = new URL(url);
      return u.searchParams.get('network') ?? null;
    } catch {
      return null;
    }
  })();
  const chosen =
    (wantNetwork
      ? decoded.accepts.find((a) =>
          (a.network ?? '')
            .toLowerCase()
            .includes(wantNetwork.replace('solana-', '').toLowerCase()),
        )
      : null) ?? decoded.accepts[0]!;
  if (!chosen.network || !chosen.payTo || !chosen.asset || !chosen.amount) {
    throw new Error('payment-required entry missing required fields');
  }
  const out: PaymentRequirementPreview = {
    network: chosen.network,
    pay_to: chosen.payTo,
    asset: chosen.asset,
    amount_atomic: chosen.amount,
    currency: chosen.currency ?? 'USDC',
  };
  if (chosen.description) out.description = chosen.description;
  return out;
}

/**
 * Cheap base58 sanity check — Solana pubkeys are 32–44 base58 chars.
 * Rejects obvious typos (whitespace, '0OIl' confusables) so the model
 * doesn't silently pass garbage to the chain. Real signature happens
 * client-side via `usePrivyUmi`, which will surface a deeper error if
 * this passes but the address is still off.
 */
function isLikelyBase58Address(s: string): boolean {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
}

/**
 * Symbol-keyed token lookup with network-aware fallbacks. Mirrors the
 * shape the treasury panel reads from the balances API so the
 * withdraw artifact's `decimals` / `program` line up with what the
 * client-side withdraw helper expects.
 */
function lookupTokenBySymbolSafe(
  symbol: string,
  network: 'mainnet' | 'devnet',
): {
  symbol: string;
  mint: string;
  decimals: number;
  program: 'spl-token' | 'spl-token-2022';
} | null {
  // Devnet/mainnet USDC/USDT/USDG mints + decimals are static and
  // already catalogued in `@leash/core/tokens`. We avoid taking a hard
  // import dep on `KNOWN_STABLES` here so this module stays
  // server-safe.
  const upper = symbol.trim().toUpperCase();
  const TABLE: Record<
    'mainnet' | 'devnet',
    Record<string, { mint: string; decimals: number; program: 'spl-token' | 'spl-token-2022' }>
  > = {
    mainnet: {
      USDC: {
        mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        decimals: 6,
        program: 'spl-token',
      },
      USDT: {
        mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        decimals: 6,
        program: 'spl-token',
      },
      USDG: {
        mint: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
        decimals: 6,
        program: 'spl-token-2022',
      },
    },
    devnet: {
      USDC: {
        mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
        decimals: 6,
        program: 'spl-token',
      },
      USDT: {
        mint: 'EcFc2cMyZxaKBkFK1XooxiyDyCPneLXiMwSJiVY6eTad',
        decimals: 6,
        program: 'spl-token',
      },
      USDG: {
        mint: '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7',
        decimals: 6,
        program: 'spl-token-2022',
      },
    },
  };
  const hit = TABLE[network][upper];
  if (!hit) return null;
  return { symbol: upper, mint: hit.mint, decimals: hit.decimals, program: hit.program };
}

function decodeBase64Json(input: string): unknown {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw =
    typeof globalThis.atob === 'function'
      ? globalThis.atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(raw);
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
