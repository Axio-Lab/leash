/**
 * `LeashHost` implementation for the standalone STDIO MCP / CLI.
 *
 * Differs from the chat product in two important ways:
 *
 *   1. **Settlement happens in-process.** `pay` and `withdraw` actually
 *      sign + submit on Solana using the local executive keypair —
 *      no UI in the loop. The result blob carries a real `tx_signature`,
 *      not a "review-the-card" artifact. This is the killer demo path.
 *
 *   2. **No platform DB / Privy session.** Off-chain calls to the
 *      Leash API authenticate via a legacy `LEASH_API_KEY` bearer
 *      token until the X-Leash-Sig auth path lands in batch 4.
 *
 * The four host methods all `try/catch` aggressively and return a
 * structured `{ status: 'ok' | 'error' }` blob — never throw — so
 * the LLM never sees a tool exception, only a recoverable JSON
 * response with a `message` it can surface.
 */

import {
  TOKEN_2022_PROGRAM_ID,
  deriveAgentTreasuryAddress,
  deriveAgentTreasuryAta,
  listSplBalances,
} from '@leash/core';
import {
  fetchDiscover,
  fetchReputation,
  isLikelyBase58Address,
  jsonResult,
  lookupTokenBySymbolSafe,
  noAgentResult,
  probePaymentLink,
  type CheckTreasuryBalanceArgs,
  type CreatePaymentLinkArgs,
  type DiscoverArgs,
  type GetIdentityArgs,
  type LeashHost,
  type LeashToolResult,
  type PayArgs,
  type ReceiptsArgs,
  type RegisterAgentArgs,
  type ReputationArgs,
  type SvmNetwork,
  type WithdrawArgs,
} from '@leash/mcp-core';
import {
  TOKEN_2022_PROGRAM_ID as UMI_TOKEN_2022_PROGRAM_ID,
  withdrawTreasury,
  withdrawTreasurySol,
} from '@leash/registry-utils';
import { createBuyer } from '@leash/buyer-kit';
import type { RulesV1 } from '@leash/schemas';

import type { LeashAgentConfig } from './config.js';
import { loadSigner, type LeashSigner } from './signer.js';

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Default spend rules baked into every standalone-MCP buyer-kit
 * call. Conservative — the user can raise these later by setting
 * env vars (LEASH_PER_CALL_USDC, LEASH_PER_DAY_USDC) or editing
 * `~/.config/leash/agent.json`. The on-chain SPL `Approve`
 * delegation is the real ceiling; these values are belt + braces.
 */
function defaultRules(): RulesV1 {
  const perCall = process.env.LEASH_PER_CALL_USDC?.trim() || '1';
  const perDay = process.env.LEASH_PER_DAY_USDC?.trim() || '10';
  return {
    v: '0.1',
    budget: { perCall, daily: perDay, currency: 'USDC' },
    hosts: {},
    triggers: [],
  };
}

function tokenNetwork(network: SvmNetwork): 'mainnet' | 'devnet' {
  return network === 'solana-mainnet' ? 'mainnet' : 'devnet';
}

/** Network slug -> buyer-kit + receipt cluster slug. */
function buyerKitNetwork(network: SvmNetwork): 'solana-mainnet' | 'solana-devnet' {
  return network;
}

/**
 * Build the standalone `LeashHost`. Captures the `LeashAgentConfig`
 * + `LeashSigner` once so per-call methods can stay tight.
 */
export function createStdioHost(config: LeashAgentConfig): LeashHost {
  const signer = loadSigner(config.executiveSecretBase58);
  return new StdioHost(config, signer);
}

class StdioHost implements LeashHost {
  agentMint: string | null;
  ownerWallet: string | null;
  network: SvmNetwork;
  rpcUrl: string;
  apiBaseUrl: string;

  private readonly config: LeashAgentConfig;
  private readonly signer: LeashSigner;

  constructor(config: LeashAgentConfig, signer: LeashSigner) {
    this.config = config;
    this.signer = signer;
    this.agentMint = config.agentMint;
    this.ownerWallet = signer.pubkey;
    this.network = config.network;
    this.rpcUrl = config.rpcUrl;
    this.apiBaseUrl = config.apiBaseUrl;
  }

  async checkTreasuryBalance(args: CheckTreasuryBalanceArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('treasury_balance');
    try {
      const treasury = await deriveAgentTreasuryAddress(this.agentMint);
      const result = await listSplBalances({
        owner: String(treasury),
        rpcUrl: this.rpcUrl,
        network: tokenNetwork(this.network),
        pinKnownStables: true,
      });
      const filtered = args.symbol
        ? result.tokens.filter((t) => (t.symbol ?? '').toLowerCase() === args.symbol!.toLowerCase())
        : result.tokens;
      return jsonResult({
        kind: 'treasury_balance',
        status: 'ok',
        treasury: String(treasury),
        network: this.network,
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
  }

  async pay(args: PayArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('payment_receipt');
    try {
      // Probe the seller's paywall first so we can pick the right
      // SPL mint for the buyer-kit's `sourceTokenAccount` (the
      // treasury's ATA for the demanded asset). The probe is cheap
      // (one HTTP GET) and lets us surface a clean error if the URL
      // isn't actually an x402 link.
      const preview = await probePaymentLink(args.url);

      const sourceAta = await deriveAgentTreasuryAta({
        asset: this.agentMint,
        mint: preview.asset,
      });

      const kitSigner = await this.signer.getKitSigner();
      const buyer = createBuyer({
        agent: this.agentMint,
        signer: kitSigner,
        networks: [buyerKitNetwork(this.network)],
        rpcUrl: this.rpcUrl,
        sourceTokenAccount: String(sourceAta.ata),
        rules: defaultRules(),
      });

      const { response, receipt, failureReason } = await buyer.fetch(args.url, {
        method: 'GET',
      });
      const bodyText = await response
        .clone()
        .text()
        .catch(() => '');

      if (receipt.tx_sig && response.ok) {
        return jsonResult({
          kind: 'payment_receipt',
          status: 'ok',
          url: args.url,
          agent_mint: this.agentMint,
          network: this.network,
          paid_amount_atomic: receipt.price?.amount ?? null,
          currency: receipt.price?.currency ?? null,
          tx_signature: receipt.tx_sig,
          response_status: response.status,
          response_body: bodyText.slice(0, 4000),
          receipt_hash: receipt.receipt_hash ?? null,
          explorer_url: explorerTxUrl(receipt.tx_sig, this.network),
        });
      }

      return jsonResult({
        kind: 'payment_receipt',
        status: 'error',
        url: args.url,
        agent_mint: this.agentMint,
        message: failureReason ?? `seller returned HTTP ${response.status}`,
        response_status: response.status,
        response_body: bodyText.slice(0, 1000),
        quoted_amount_atomic: receipt.price?.amount ?? null,
      });
    } catch (err) {
      return jsonResult({
        kind: 'payment_receipt',
        status: 'error',
        url: args.url,
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  async withdraw(args: WithdrawArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('withdraw_receipt');
    if (!isLikelyBase58Address(args.destination)) {
      return jsonResult({
        kind: 'withdraw_receipt',
        status: 'error',
        message: 'Destination does not look like a Solana wallet address (base58, 32–44 chars).',
      });
    }
    try {
      const umi = this.signer.getUmi(this.rpcUrl);
      if (args.token === 'SOL') {
        const lamports = BigInt(Math.floor(args.amount * Number(LAMPORTS_PER_SOL)));
        if (lamports <= 0n) {
          return jsonResult({
            kind: 'withdraw_receipt',
            status: 'error',
            message: 'Amount rounds to zero lamports — request a larger amount.',
          });
        }
        const result = await withdrawTreasurySol(umi, {
          agentAsset: this.agentMint,
          destination: args.destination,
          lamports,
        });
        return jsonResult({
          kind: 'withdraw_receipt',
          status: 'ok',
          agent_mint: this.agentMint,
          token: 'SOL',
          decimals: 9,
          amount: String(args.amount),
          amount_atomic: lamports.toString(),
          destination: args.destination,
          treasury: result.treasury,
          tx_signature: result.signature,
          network: this.network,
          explorer_url: explorerTxUrl(result.signature, this.network),
        });
      }

      const meta = lookupTokenBySymbolSafe(args.token, tokenNetwork(this.network));
      if (!meta) {
        return jsonResult({
          kind: 'withdraw_receipt',
          status: 'error',
          message: `Token ${args.token} is not catalogued on ${this.network}. Try USDC, USDG, or USDT.`,
        });
      }
      const atomic = BigInt(Math.floor(args.amount * 10 ** meta.decimals));
      if (atomic <= 0n) {
        return jsonResult({
          kind: 'withdraw_receipt',
          status: 'error',
          message: 'Amount rounds to zero atomic units — request a larger amount.',
        });
      }
      const result = await withdrawTreasury(umi, {
        agentAsset: this.agentMint,
        mint: meta.mint,
        destination: args.destination,
        amount: atomic,
        decimals: meta.decimals,
        ...(meta.program === 'spl-token-2022' ? { tokenProgram: UMI_TOKEN_2022_PROGRAM_ID } : {}),
      });
      return jsonResult({
        kind: 'withdraw_receipt',
        status: 'ok',
        agent_mint: this.agentMint,
        token: meta.symbol,
        mint: meta.mint,
        token_program: meta.program === 'spl-token-2022' ? TOKEN_2022_PROGRAM_ID : null,
        decimals: meta.decimals,
        amount: String(args.amount),
        amount_atomic: atomic.toString(),
        destination: args.destination,
        treasury: result.treasury,
        tx_signature: result.signature,
        network: this.network,
        explorer_url: explorerTxUrl(result.signature, this.network),
      });
    } catch (err) {
      return jsonResult({
        kind: 'withdraw_receipt',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  async createPaymentLink(args: CreatePaymentLinkArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('payment_link');

    // Until X-Leash-Sig auth ships in batch 4, the standalone MCP
    // requires a legacy API key. If the user hasn't set one, return a
    // clean error the LLM can surface verbatim.
    if (!this.config.apiKey) {
      return jsonResult({
        kind: 'payment_link',
        status: 'error',
        message:
          'Creating payment links from the standalone MCP currently requires LEASH_API_KEY in the environment. (X-Leash-Sig auth ships in the next release.)',
      });
    }

    try {
      const body = {
        label: args.label,
        description: args.description,
        owner_agent: this.agentMint,
        method: 'GET',
        price: `${args.amount} ${args.currency}`,
        currency: args.currency,
        response: {
          status: 200,
          mimeType: 'application/json',
          body: { ok: true, label: args.label },
        },
      };
      const res = await fetch(`${this.apiBaseUrl}/v1/payment-links`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        return jsonResult({
          kind: 'payment_link',
          status: 'error',
          message: `Leash API ${res.status}: ${text.slice(0, 300)}`,
        });
      }
      const json = JSON.parse(text) as {
        id: string;
        share_url: string;
        network: string;
        owner_agent: string;
      };
      return jsonResult({
        kind: 'payment_link',
        status: 'ok',
        id: json.id,
        url: json.share_url,
        price: `${args.amount} ${args.currency}`,
        currency: args.currency,
        label: args.label,
        network: json.network,
        owner_agent: json.owner_agent,
      });
    } catch (err) {
      return jsonResult({
        kind: 'payment_link',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  async registerAgent(_args: RegisterAgentArgs): Promise<LeashToolResult> {
    return jsonResult({
      kind: 'register_agent',
      status: 'already_registered',
      agent_mint: this.agentMint,
      executive_pubkey: this.ownerWallet,
      network: this.network,
      message: `Agent ${this.agentMint} is already registered on this host. Use \`leash_get_identity\` to inspect it, or rotate to a fresh agent by deleting \`~/.config/leash/agent.json\` and re-running.`,
    });
  }

  async getIdentity(_args: GetIdentityArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('identity');
    try {
      const treasury = await deriveAgentTreasuryAddress(this.agentMint);
      return jsonResult({
        kind: 'identity',
        status: 'ok',
        agent_mint: this.agentMint,
        treasury_address: String(treasury),
        executive_pubkey: this.ownerWallet,
        network: this.network,
        api_base_url: this.apiBaseUrl,
        rpc_url: this.rpcUrl,
        explorer_url: explorerAccountUrl(this.agentMint, this.network),
      });
    } catch (err) {
      return jsonResult({
        kind: 'identity',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  async receipts(args: ReceiptsArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('receipts');
    if (!this.config.apiKey) {
      return jsonResult({
        kind: 'receipts',
        status: 'error',
        message:
          'Listing receipts from the standalone MCP currently requires LEASH_API_KEY in the environment. (X-Leash-Sig auth ships in the next release alongside discovery + reputation.)',
      });
    }
    try {
      const url = new URL(`${this.apiBaseUrl}/v1/receipts/${this.agentMint}`);
      if (args.limit) url.searchParams.set('limit', String(args.limit));
      if (args.direction === 'outgoing') url.searchParams.set('kind', 'spend');
      else if (args.direction === 'incoming') url.searchParams.set('kind', 'earn');

      const res = await fetch(url, {
        headers: { authorization: `Bearer ${this.config.apiKey}` },
      });
      const text = await res.text();
      if (!res.ok) {
        return jsonResult({
          kind: 'receipts',
          status: 'error',
          message: `Leash API ${res.status}: ${text.slice(0, 300)}`,
        });
      }
      const json = JSON.parse(text) as {
        items: Array<{
          receipt_hash: string;
          tx_sig: string | null;
          decision: string;
          kind: 'spend' | 'earn';
          ingested_at: string;
          raw: { request?: { url?: string }; price?: { amount?: string; currency?: string } };
        }>;
        next_cursor: string | null;
      };
      return jsonResult({
        kind: 'receipts',
        status: 'ok',
        agent_mint: this.agentMint,
        network: this.network,
        count: json.items.length,
        next_cursor: json.next_cursor,
        items: json.items.map((r) => ({
          receipt_hash: r.receipt_hash,
          direction: r.kind === 'spend' ? 'outgoing' : 'incoming',
          decision: r.decision,
          tx_signature: r.tx_sig,
          url: r.raw?.request?.url ?? null,
          amount: r.raw?.price?.amount ?? null,
          currency: r.raw?.price?.currency ?? null,
          timestamp: r.ingested_at,
          explorer_url: r.tx_sig ? explorerTxUrl(r.tx_sig, this.network) : null,
        })),
      });
    } catch (err) {
      return jsonResult({
        kind: 'receipts',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  async discover(args: DiscoverArgs): Promise<LeashToolResult> {
    return fetchDiscover({
      apiBaseUrl: this.apiBaseUrl,
      network: this.network,
      query: args,
    });
  }

  async reputation(args: ReputationArgs): Promise<LeashToolResult> {
    return fetchReputation({
      apiBaseUrl: this.apiBaseUrl,
      network: this.network,
      query: args,
    });
  }
}

function explorerAccountUrl(pubkey: string, network: SvmNetwork): string {
  const cluster = network === 'solana-mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/account/${pubkey}${cluster}`;
}

function explorerTxUrl(signature: string, network: SvmNetwork): string {
  const cluster = network === 'solana-mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/tx/${signature}${cluster}`;
}
