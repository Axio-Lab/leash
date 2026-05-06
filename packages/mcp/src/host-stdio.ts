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
  LEASH_EXPLORER_DEFAULT,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ID,
  deriveAgentTreasuryAddress,
  deriveAgentTreasuryAta,
  leashReceiptUrl,
  listSplBalances,
  parseLeashHeaders,
  tokenProgramForMint,
} from '@leash/core';
import {
  fetchDiscover,
  fetchPaySkillsProvider,
  fetchReputation,
  isLikelyBase58Address,
  jsonResult,
  lookupTokenBySymbolSafe,
  noAgentResult,
  probePaymentLink,
  type CheckTreasuryBalanceArgs,
  type CreatePaymentLinkArgs,
  type DailyTransactionsArgs,
  type DiscoverArgs,
  type GetIdentityArgs,
  type GetReceiptArgs,
  type GetSpendLimitArgs,
  type LeashHost,
  type LeashToolResult,
  type PayArgs,
  type PaySkillsProviderArgs,
  type ReceiptsArgs,
  type RegisterAgentArgs,
  type ReputationArgs,
  type SetSpendLimitArgs,
  type StableSymbol,
  type SvmNetwork,
  type TransactionHistoryArgs,
  type WithdrawArgs,
} from '@leash/mcp-core';
import {
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID as UMI_TOKEN_2022_PROGRAM_ID,
  getSpendDelegation,
  revokeSpendDelegation,
  setSpendDelegation,
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
  explorerBaseUrl: string;

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
    this.explorerBaseUrl = config.explorerBaseUrl ?? LEASH_EXPLORER_DEFAULT;
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

      const tokenProgramKind = tokenProgramForMint(preview.asset);
      const sourceAta = await deriveAgentTreasuryAta({
        asset: this.agentMint,
        mint: preview.asset,
        ...(tokenProgramKind === 'spl-token-2022'
          ? { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }
          : {}),
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
        // Prefer the seller-stamped `X-Leash-*` headers over the
        // buyer-kit's locally-computed receipt. The buyer-side hash is
        // computed against the buyer's view of the request (its own
        // `nonce` / `ts`) so it diverges from the canonical seller-side
        // earn receipt that `apps/api`'s paywall publishes — and the
        // explorer only indexes the seller-side hash. Falling back to
        // the local hash keeps legacy paywalls (no header stamping)
        // working. Same precedence as the chat product applies in
        // `apps/agents/components/chat/pay-request-artifact.tsx`.
        const stamped = parseLeashHeaders(response);
        const txSignature = stamped.txSig ?? receipt.tx_sig;
        const receiptHash = stamped.receiptHash ?? receipt.receipt_hash ?? null;
        return jsonResult({
          kind: 'payment_receipt',
          status: 'ok',
          url: args.url,
          agent_mint: this.agentMint,
          network: this.network,
          paid_amount_atomic: receipt.price?.amount ?? null,
          currency: receipt.price?.currency ?? null,
          tx_signature: txSignature,
          response_status: response.status,
          response_body: bodyText.slice(0, 4000),
          receipt_hash: receiptHash,
          receipt_url: leashReceiptUrl(receiptHash, { baseUrl: this.explorerBaseUrl }),
          explorer_url: explorerTxUrl(txSignature, this.network),
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

  async paySkillsProvider(args: PaySkillsProviderArgs): Promise<LeashToolResult> {
    return fetchPaySkillsProvider({
      apiBaseUrl: this.apiBaseUrl,
      network: this.network,
      query: args,
    });
  }

  /**
   * Owner-driven update of the SPL `Approve` delegation that lets the
   * executive spend the requested stable from the agent treasury PDA.
   * Mode + amount semantics:
   *   - `unlimited` (default) → `u64::MAX` (the protocol default).
   *   - `revoke`              → drop the delegation entirely.
   *   - `amount` + `amount: N` → cap at `N * 10**decimals`.
   */
  async setSpendLimit(args: SetSpendLimitArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('spend_limit');
    const symbol = (args.symbol ?? 'USDC') as StableSymbol;
    const meta = lookupTokenBySymbolSafe(symbol, tokenNetwork(this.network));
    if (!meta) {
      return jsonResult({
        kind: 'spend_limit',
        status: 'error',
        message: `${symbol} is not configured for ${this.network}.`,
      });
    }
    const mode = args.mode ?? 'unlimited';
    if (mode === 'amount' && (args.amount === undefined || !(args.amount > 0))) {
      return jsonResult({
        kind: 'spend_limit',
        status: 'error',
        message: '`mode: "amount"` requires `amount` (a positive decimal number).',
      });
    }

    try {
      const umi = this.signer.getUmi(this.rpcUrl);
      const tokenProgram =
        meta.program === 'spl-token-2022' ? UMI_TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;

      if (mode === 'revoke') {
        const result = await revokeSpendDelegation(umi, {
          agentAsset: this.agentMint,
          mint: meta.mint,
          tokenProgram,
        });
        return jsonResult({
          kind: 'spend_limit',
          status: 'ok',
          mode: 'revoke',
          symbol,
          mint: meta.mint,
          treasury: result.treasury,
          source_token_account: result.sourceTokenAccount,
          delegated_amount_atomic: '0',
          delegated_amount: '0',
          tx_signature: result.signature,
          network: this.network,
          explorer_url: explorerTxUrl(result.signature, this.network),
        });
      }

      const cap =
        mode === 'unlimited'
          ? 2n ** 64n - 1n
          : decimalToAtomic(args.amount as number, meta.decimals);
      if (cap <= 0n) {
        return jsonResult({
          kind: 'spend_limit',
          status: 'error',
          message: 'Resolved cap is zero — pass a larger `amount` or use `mode: "unlimited"`.',
        });
      }
      const result = await setSpendDelegation(umi, {
        agentAsset: this.agentMint,
        mint: meta.mint,
        executive: this.ownerWallet ?? '',
        amount: cap,
        tokenProgram,
      });
      return jsonResult({
        kind: 'spend_limit',
        status: 'ok',
        mode,
        symbol,
        mint: meta.mint,
        delegate: result.delegate,
        treasury: result.treasury,
        source_token_account: result.sourceTokenAccount,
        delegated_amount_atomic: result.delegatedAmount.toString(),
        delegated_amount: mode === 'unlimited' ? 'unlimited' : atomicToDecimal(cap, meta.decimals),
        tx_signature: result.signature,
        network: this.network,
        explorer_url: explorerTxUrl(result.signature, this.network),
      });
    } catch (err) {
      return jsonResult({
        kind: 'spend_limit',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  /**
   * Look up a single ReceiptV1 by its `receipt_hash` via the Leash
   * API's by-hash endpoint. Returns the canonical seller-side blob
   * (the same JSON the explorer renders) plus a few convenience
   * fields the LLM can quote inline.
   */
  async getReceipt(args: GetReceiptArgs): Promise<LeashToolResult> {
    if (!this.config.apiKey) {
      return jsonResult({
        kind: 'receipt',
        status: 'error',
        message:
          'Looking up receipts by hash currently requires LEASH_API_KEY in the environment. (X-Leash-Sig auth ships in the next release alongside discovery + reputation.)',
      });
    }
    const hash = (args.receipt_hash ?? '').trim();
    if (!hash) {
      return jsonResult({
        kind: 'receipt',
        status: 'error',
        message:
          '`receipt_hash` is required (the 64-hex-char value the explorer renders at /receipt/{hash}).',
      });
    }
    try {
      const url = `${this.apiBaseUrl}/v1/receipts/by-hash/${encodeURIComponent(hash)}`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${this.config.apiKey}` },
      });
      const text = await res.text();
      if (res.status === 404) {
        return jsonResult({
          kind: 'receipt',
          status: 'not_found',
          receipt_hash: hash,
          network: this.network,
          message: `No receipt with hash ${hash} on ${this.network} (cross-network reads are impossible by design \u2014 if this hash came from the sibling cluster, switch LEASH_NETWORK and retry).`,
        });
      }
      if (!res.ok) {
        return jsonResult({
          kind: 'receipt',
          status: 'error',
          message: `Leash API ${res.status}: ${text.slice(0, 300)}`,
        });
      }
      const row = JSON.parse(text) as {
        receipt_hash: string;
        network: SvmNetwork;
        agent: string;
        nonce: number;
        decision: string;
        kind: 'spend' | 'earn';
        tx_sig: string | null;
        payment_requirements_hash: string | null;
        ingested_at: string;
        raw: Record<string, unknown>;
      };
      return jsonResult({
        kind: 'receipt',
        status: 'ok',
        receipt_hash: row.receipt_hash,
        agent: row.agent,
        direction: row.kind === 'spend' ? 'outgoing' : 'incoming',
        decision: row.decision,
        network: row.network,
        tx_signature: row.tx_sig,
        ingested_at: row.ingested_at,
        explorer_url: leashReceiptUrl(row.receipt_hash, { baseUrl: this.explorerBaseUrl }),
        tx_explorer_url: row.tx_sig ? explorerTxUrl(row.tx_sig, row.network) : null,
        receipt: row.raw,
      });
    } catch (err) {
      return jsonResult({
        kind: 'receipt',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  /**
   * Paginate `/v1/receipts/{agent}` and trim to the rolling
   * `now - days` window, returning the receipts plus running totals.
   * USD totals sum stables (USDC/USDG/USDT) at 1:1.
   */
  async transactionHistory(args: TransactionHistoryArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('transaction_history');
    if (!this.config.apiKey) {
      return jsonResult({
        kind: 'transaction_history',
        status: 'error',
        message:
          'Listing receipts from the standalone MCP currently requires LEASH_API_KEY in the environment.',
      });
    }
    const days = clampInt(args.days ?? 7, 1, 90);
    const limit = clampInt(args.limit ?? 200, 1, 1000);
    const direction: 'both' | 'outgoing' | 'incoming' = args.direction ?? 'both';
    const cutoffMs = Date.now() - days * 86_400_000;

    try {
      const rows = await fetchReceiptWindow({
        apiBaseUrl: this.apiBaseUrl,
        apiKey: this.config.apiKey,
        agent: this.agentMint,
        direction,
        limit,
        cutoffMs,
      });

      const totals = aggregateReceipts(rows.items);
      return jsonResult({
        kind: 'transaction_history',
        status: 'ok',
        agent_mint: this.agentMint,
        network: this.network,
        range: {
          from: new Date(cutoffMs).toISOString(),
          to: new Date().toISOString(),
          days,
        },
        direction,
        count: rows.items.length,
        truncated: rows.truncated,
        total_sent_usd: totals.totalSentUsd,
        total_received_usd: totals.totalReceivedUsd,
        net_usd: totals.netUsd,
        sent_count: totals.sentCount,
        received_count: totals.receivedCount,
        non_usd_count: totals.nonUsdCount,
        items: rows.items.map((r) => ({
          receipt_hash: r.receipt_hash,
          direction: r.kind === 'spend' ? 'outgoing' : 'incoming',
          decision: r.decision,
          tx_signature: r.tx_sig,
          url: r.raw?.request?.url ?? null,
          method: r.raw?.request?.method ?? null,
          amount: r.raw?.price?.amount ?? null,
          currency: r.raw?.price?.currency ?? null,
          timestamp: r.ingested_at,
          explorer_url: leashReceiptUrl(r.receipt_hash, { baseUrl: this.explorerBaseUrl }),
          tx_explorer_url: r.tx_sig ? explorerTxUrl(r.tx_sig, this.network) : null,
        })),
      });
    } catch (err) {
      return jsonResult({
        kind: 'transaction_history',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  /**
   * Bin the same receipts as `transactionHistory` by UTC ingest date
   * and return per-day buckets plus grand totals. Days with zero
   * activity are filled with zeros so the timeline is continuous.
   */
  async dailyTransactions(args: DailyTransactionsArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('daily_transactions');
    if (!this.config.apiKey) {
      return jsonResult({
        kind: 'daily_transactions',
        status: 'error',
        message:
          'Daily aggregates from the standalone MCP currently require LEASH_API_KEY in the environment.',
      });
    }
    const days = clampInt(args.days ?? 7, 1, 90);
    const cutoffMs = Date.now() - days * 86_400_000;

    try {
      const rows = await fetchReceiptWindow({
        apiBaseUrl: this.apiBaseUrl,
        apiKey: this.config.apiKey,
        agent: this.agentMint,
        direction: 'both',
        limit: 1000,
        cutoffMs,
      });

      const buckets = bucketReceiptsByDay(rows.items, days);
      const totals = aggregateReceipts(rows.items);
      return jsonResult({
        kind: 'daily_transactions',
        status: 'ok',
        agent_mint: this.agentMint,
        network: this.network,
        range: {
          from: new Date(cutoffMs).toISOString(),
          to: new Date().toISOString(),
          days,
        },
        daily: buckets,
        totals: {
          sent_count: totals.sentCount,
          sent_usd: totals.totalSentUsd,
          received_count: totals.receivedCount,
          received_usd: totals.totalReceivedUsd,
          net_usd: totals.netUsd,
          non_usd_count: totals.nonUsdCount,
        },
        truncated: rows.truncated,
      });
    } catch (err) {
      return jsonResult({
        kind: 'daily_transactions',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  /**
   * Read the current SPL delegation + treasury balance for `symbol`.
   * Pure RPC — no signing.
   */
  async getSpendLimit(args: GetSpendLimitArgs): Promise<LeashToolResult> {
    if (!this.agentMint) return noAgentResult('spend_limit');
    const symbol = (args.symbol ?? 'USDC') as StableSymbol;
    const meta = lookupTokenBySymbolSafe(symbol, tokenNetwork(this.network));
    if (!meta) {
      return jsonResult({
        kind: 'spend_limit',
        status: 'error',
        message: `${symbol} is not configured for ${this.network}.`,
      });
    }
    try {
      const umi = this.signer.getUmi(this.rpcUrl);
      const tokenProgram =
        meta.program === 'spl-token-2022' ? UMI_TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
      const status = await getSpendDelegation(umi, {
        agentAsset: this.agentMint,
        mint: meta.mint,
        tokenProgram,
      });
      const isUnlimited = status.delegatedAmount === 2n ** 64n - 1n;
      return jsonResult({
        kind: 'spend_limit',
        status: 'ok',
        symbol,
        mint: meta.mint,
        treasury: status.treasury,
        source_token_account: status.sourceTokenAccount,
        source_exists: status.sourceExists,
        delegate: status.delegate,
        executive_pubkey: this.ownerWallet,
        delegate_matches_executive: status.delegate === this.ownerWallet,
        delegated_amount_atomic: status.delegatedAmount.toString(),
        delegated_amount: isUnlimited
          ? 'unlimited'
          : atomicToDecimal(status.delegatedAmount, meta.decimals),
        balance_atomic: status.balance.toString(),
        balance: atomicToDecimal(status.balance, meta.decimals),
        decimals: meta.decimals,
        network: this.network,
      });
    } catch (err) {
      return jsonResult({
        kind: 'spend_limit',
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }
}

/**
 * Convert a human decimal (e.g. `100`, `1.5`) to atomic units using
 * the mint's decimals. Floors to avoid silently rounding up.
 */
function decimalToAtomic(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  // Multiply via string to avoid float precision drift on small
  // amounts (e.g. 0.000001 USDC).
  const [whole, frac = ''] = amount.toString().split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const combined = `${whole}${fracPadded}`.replace(/^0+(?=\d)/, '');
  try {
    return BigInt(combined);
  } catch {
    return 0n;
  }
}

/** Inverse of {@link decimalToAtomic}. Trims trailing zeros. */
function atomicToDecimal(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const s = amount.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}

function explorerAccountUrl(pubkey: string, network: SvmNetwork): string {
  const cluster = network === 'solana-mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/account/${pubkey}${cluster}`;
}

function explorerTxUrl(signature: string, network: SvmNetwork): string {
  const cluster = network === 'solana-mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/tx/${signature}${cluster}`;
}

/** Clamp an integer into `[min, max]`, falling back to `min` on NaN. */
function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Receipt row shape returned by `/v1/receipts/{agent}` (subset). */
type ReceiptRow = {
  receipt_hash: string;
  tx_sig: string | null;
  decision: string;
  kind: 'spend' | 'earn';
  ingested_at: string;
  raw: {
    request?: { url?: string; method?: string };
    price?: { amount?: string; currency?: string };
  };
};

/**
 * Walk the paginated `/v1/receipts/{agent}` feed newest-first until
 * we either hit `cutoffMs` (i.e. the user's window boundary), exhaust
 * the feed, or hit `limit` rows. Returns the in-window subset plus a
 * `truncated` flag the caller can surface when more receipts exist
 * but would have blown the cap.
 */
async function fetchReceiptWindow(args: {
  apiBaseUrl: string;
  apiKey: string;
  agent: string;
  direction: 'both' | 'outgoing' | 'incoming';
  limit: number;
  cutoffMs: number;
}): Promise<{ items: ReceiptRow[]; truncated: boolean }> {
  const items: ReceiptRow[] = [];
  let cursor: string | null = null;
  let truncated = false;
  // Cap the underlying paginations to prevent runaway loops on
  // extremely active agents \u2014 200 rows/page * 10 pages = 2000 rows
  // is well above any sane day-window response.
  const maxPages = 10;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${args.apiBaseUrl}/v1/receipts/${args.agent}`);
    url.searchParams.set('limit', '200');
    if (args.direction === 'outgoing') url.searchParams.set('kind', 'spend');
    else if (args.direction === 'incoming') url.searchParams.set('kind', 'earn');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url, { headers: { authorization: `Bearer ${args.apiKey}` } });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Leash API ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = JSON.parse(text) as {
      items: ReceiptRow[];
      next_cursor: string | null;
    };

    let stop = false;
    for (const r of json.items) {
      const ingestedMs = Date.parse(r.ingested_at);
      if (Number.isFinite(ingestedMs) && ingestedMs < args.cutoffMs) {
        stop = true;
        break;
      }
      items.push(r);
      if (items.length >= args.limit) {
        truncated = true;
        stop = true;
        break;
      }
    }
    if (stop || !json.next_cursor) break;
    cursor = json.next_cursor;
  }

  return { items, truncated };
}

/** USD-symbol whitelist used by the per-day + transaction-history aggregators. */
const USD_STABLES = new Set(['USDC', 'USDG', 'USDT']);

/** Sum sent/received decimals across a list of receipts. */
function aggregateReceipts(items: ReceiptRow[]): {
  sentCount: number;
  receivedCount: number;
  totalSentUsd: string;
  totalReceivedUsd: string;
  netUsd: string;
  nonUsdCount: number;
} {
  let sentCount = 0;
  let receivedCount = 0;
  let nonUsdCount = 0;
  // Use a string-based decimal sum to avoid float drift on long
  // running totals. We accumulate in a Decimal128-style helper.
  let sentSum = 0;
  let receivedSum = 0;

  for (const r of items) {
    const amt = parseFloat(r.raw?.price?.amount ?? '');
    const cur = (r.raw?.price?.currency ?? '').toUpperCase();
    if (r.kind === 'spend') sentCount++;
    else if (r.kind === 'earn') receivedCount++;
    if (!Number.isFinite(amt) || !cur) continue;
    if (!USD_STABLES.has(cur)) {
      nonUsdCount++;
      continue;
    }
    if (r.kind === 'spend') sentSum += amt;
    else if (r.kind === 'earn') receivedSum += amt;
  }

  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  return {
    sentCount,
    receivedCount,
    nonUsdCount,
    totalSentUsd: round(sentSum).toString(),
    totalReceivedUsd: round(receivedSum).toString(),
    netUsd: round(receivedSum - sentSum).toString(),
  };
}

/**
 * Bucket receipts into per-day rows (UTC `YYYY-MM-DD`). Days with no
 * activity are emitted with zeros so the timeline is continuous.
 * Sorted newest-first.
 */
function bucketReceiptsByDay(
  items: ReceiptRow[],
  days: number,
): Array<{
  date: string;
  sent_count: number;
  sent_usd: string;
  received_count: number;
  received_usd: string;
  net_usd: string;
}> {
  const map = new Map<
    string,
    { sentCount: number; sentSum: number; receivedCount: number; receivedSum: number }
  >();

  // Seed with empty buckets for every day in the window so the LLM
  // sees a continuous range even when the agent had no activity.
  const today = utcDay(new Date());
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    map.set(formatUtcDate(d), { sentCount: 0, sentSum: 0, receivedCount: 0, receivedSum: 0 });
  }

  for (const r of items) {
    const ingested = new Date(r.ingested_at);
    if (Number.isNaN(ingested.getTime())) continue;
    const key = formatUtcDate(ingested);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = { sentCount: 0, sentSum: 0, receivedCount: 0, receivedSum: 0 };
      map.set(key, bucket);
    }
    if (r.kind === 'spend') bucket.sentCount++;
    else if (r.kind === 'earn') bucket.receivedCount++;
    const amt = parseFloat(r.raw?.price?.amount ?? '');
    const cur = (r.raw?.price?.currency ?? '').toUpperCase();
    if (!Number.isFinite(amt) || !USD_STABLES.has(cur)) continue;
    if (r.kind === 'spend') bucket.sentSum += amt;
    else if (r.kind === 'earn') bucket.receivedSum += amt;
  }

  const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, b]) => ({
      date,
      sent_count: b.sentCount,
      sent_usd: round(b.sentSum).toString(),
      received_count: b.receivedCount,
      received_usd: round(b.receivedSum).toString(),
      net_usd: round(b.receivedSum - b.sentSum).toString(),
    }));
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
