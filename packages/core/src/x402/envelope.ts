/**
 * The Leash payment envelope.
 *
 * After a successful x402 settlement the seller's `/x/<id>` route attaches a
 * compact summary of the payment to the response — both as `X-Leash-*`
 * response headers and (optionally) as a JSON `_leash` field via
 * `wrap_receipt`. That summary is also the body of every webhook delivered
 * to the configured `webhook_url`.
 *
 * Putting the shape + builder in `@leashmarket/core` means producers (the seller
 * route) and consumers (buyer-kit, downstream agents) share one TypeScript
 * type. Don't construct envelope objects ad-hoc; always go through
 * {@link buildLeashEnvelope}.
 */

import type { ReceiptAny } from '@leashmarket/schemas';
import { isReceiptV02 } from '@leashmarket/schemas';
import {
  agentExplorerUrl,
  transactionExplorerUrl,
  type ExplorerProvider,
} from '../explorer/index.js';
import { networkFromCaip2 } from './client.js';
import type { TokenNetwork } from '../tokens/index.js';

export type LeashPaymentEnvelope = {
  /** Settled SPL transaction signature (null if no settlement happened). */
  tx_sig: string | null;
  /** SHA-256 of the canonical receipt — useful as an idempotency key. */
  receipt_hash: string;
  /** Mint address of the agent that earned the payment. */
  agent: string;
  /** Friendly slug like `solana-devnet`. May be `null` for legacy receipts. */
  network: string | null;
  /**
   * Atomic `amount` + display `currency`. Decode against
   * {@link KNOWN_TOKENS} via `formatTokenBalance` to render decimals.
   */
  amount: { amount: string; currency: string } | null;
  /** Facilitator URL that settled the transfer. */
  facilitator: string | null;
  explorer: {
    /** Explorer URL for the SPL transfer (null if no signature). */
    tx: string | null;
    /** Explorer URL for the agent / app surfacing the agent. */
    agent: string;
  };
};

export type BuildLeashEnvelopeOptions = {
  /** Web origin used to build the `explorer.agent` link. */
  origin: string;
  /**
   * Used to derive the `?cluster=` query for the on-chain explorer link.
   * Leash maps `solana-testnet` → `devnet` here because v0.1 has no testnet
   * facilitator; consumers can override by passing `'mainnet'` or `'devnet'`
   * explicitly.
   */
  network?: TokenNetwork;
  /** Explorer provider for the `tx` link. Defaults to Solscan. */
  explorerProvider?: ExplorerProvider;
};

function settlementTxForEnvelope(receipt: ReceiptAny): string | null {
  if (isReceiptV02(receipt) && receipt.protocol === 'mpp') {
    const s = receipt.tx_sig ?? receipt.mpp_settlement_tx;
    return s != null && s.length > 0 ? s : null;
  }
  if (isReceiptV02(receipt)) {
    const s = receipt.tx_sig;
    return s != null && s.length > 0 ? s : null;
  }
  const s = receipt.tx_sig;
  return s != null && s.length > 0 ? s : null;
}

/**
 * Build a {@link LeashPaymentEnvelope} from a settled `earn` receipt (v0.1 or v0.2).
 *
 * The receipt is treated as the source of truth for settlement signature, `agent`,
 * `price`, and `facilitator`. Explorer links are derived from `network` so
 * devnet receipts get the `?cluster=devnet` suffix automatically.
 */
export function buildLeashEnvelope(
  receipt: ReceiptAny,
  opts: BuildLeashEnvelopeOptions,
): LeashPaymentEnvelope {
  const network = opts.network ?? deriveTokenNetwork(receipt);
  const provider = opts.explorerProvider ?? 'solscan';
  const txSig = settlementTxForEnvelope(receipt);
  return {
    tx_sig: txSig,
    receipt_hash: receipt.receipt_hash,
    agent: receipt.agent,
    network: receipt.price?.network ?? null,
    amount: receipt.price
      ? { amount: receipt.price.amount, currency: receipt.price.currency }
      : null,
    facilitator: receipt.facilitator ?? null,
    explorer: {
      tx: transactionExplorerUrl(txSig, { network, provider }),
      agent: agentAppUrl(opts.origin, receipt.agent, provider, network),
    },
  };
}

/**
 * Derive a friendly `TokenNetwork` from a receipt's `price.network`. Returns
 * `'devnet'` as a safe default when the receipt is missing network info —
 * matches the Leash playground's primary cluster.
 */
function deriveTokenNetwork(receipt: ReceiptAny): TokenNetwork {
  const slug = receipt.price?.network ?? null;
  const friendly = networkFromCaip2(slug);
  if (friendly === 'solana-mainnet') return 'mainnet';
  return 'devnet';
}

/**
 * Build the in-app agent profile URL. We always link to the *app* (not raw
 * Solscan) for the agent because the Leash agent profile is the richer view
 * (treasury + receipts + delegation). Solscan-only callers can derive the
 * raw chain explorer URL via {@link agentExplorerUrl}.
 */
function agentAppUrl(
  origin: string,
  mint: string,
  provider: ExplorerProvider,
  network: TokenNetwork,
): string {
  // Origin form is preferred for anything served by a Leash deployment;
  // `agentExplorerUrl` is the chain-explorer fallback for off-app contexts.
  if (origin) return `${origin}/agents/${mint}`;
  return agentExplorerUrl(mint, { provider, network }) ?? `solana://${mint}`;
}
