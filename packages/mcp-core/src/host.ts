/**
 * `LeashHost` is the runtime contract every Leash MCP host (chat
 * product, standalone STDIO MCP, CLI, etc.) implements. The shared
 * tool definitions in `./tools` delegate to this interface, so the
 * same tool name + schema works across surfaces with completely
 * different settlement semantics:
 *
 * - Chat product: `pay()` returns a `payment_request` artifact (the
 *   UI renders a "Pay" card; the user signs in their browser via
 *   Privy). Treasury reads happen server-side over the cluster RPC.
 *
 * - Standalone MCP / CLI: `pay()` actually settles the payment by
 *   signing the buyer-kit transfer with the local executive
 *   keypair and returns the receipt. No human in the loop.
 *
 * Adding a new tool is one file in `./tools` plus one method on each
 * implementer of this interface.
 */

import type { LeashToolResult } from './tool.js';

/** SVM cluster slugs as used by the Leash API + Metaplex SDK. */
export type SvmNetwork = 'solana-devnet' | 'solana-mainnet';

/** Stablecoins the Leash treasury supports across networks. */
export type StableSymbol = 'USDC' | 'USDG' | 'USDT';

/** Tokens supported by the withdraw tool — adds SOL on top of stables. */
export type WithdrawableToken = 'SOL' | StableSymbol;

// ────────────────────────────────────────────────────────────────────────────
// Per-tool host argument shapes — kept here so hosts get strict types
// even before they're called by the (loosely typed) JSON tool schemas.
// ────────────────────────────────────────────────────────────────────────────

export type CreatePaymentLinkArgs = {
  amount: number;
  currency: StableSymbol;
  label: string;
  description?: string;
};

export type PayArgs = {
  url: string;
};

export type WithdrawArgs = {
  token: WithdrawableToken;
  amount: number;
  destination: string;
};

export type CheckTreasuryBalanceArgs = {
  symbol?: string;
};

export type RegisterAgentArgs = {
  /**
   * Friendly agent name recorded in MPL Core metadata. Optional —
   * defaults to `Agent <executive_pubkey[0..8]>` when omitted.
   */
  name?: string;
  /**
   * Free-text description recorded in the MPL Core asset and the
   * EIP-8004 RegistrationV1 metadata doc.
   */
  description?: string;
  /**
   * Optional public image URL written into the RegistrationV1
   * metadata's `image` field (e.g. an avatar / logo).
   */
  image_url?: string;
  /**
   * EIP-8004 RegistrationV1 `services[]` entries the agent
   * advertises. Threaded into three places at mint time:
   *   1. On-chain MPL Core `agentMetadata.services[]`.
   *   2. Off-chain RegistrationV1 doc embedded in the asset `uri`.
   *   3. Platform `services` column written by `/v1/agents/record`.
   * The Leash protocol always auto-injects a `receipts` entry, so
   * callers don't need to supply one. Each entry must be `{ name,
   * endpoint }` where `endpoint` is a valid URL.
   *
   * Persisted alongside the executive in `pending_register` so the
   * SECOND `leash_register_agent` call (after the user funds the
   * pubkey) doesn't need to re-collect them.
   */
  services?: { name: string; endpoint: string }[];
  /**
   * Owner-keypair source.
   *   - `'generate'` (default) — host generates a fresh ed25519 keypair
   *     locally, persists it to `~/.config/leash/agent.json` under
   *     `pending_register`, and asks the user to fund it.
   *   - `'import'` — caller supplies an existing keypair via
   *     `executive_secret_base58`. Same persistence + funding-check
   *     path; the caller stays in control of the signing key.
   *
   * The mode is only consulted on the FIRST call. Subsequent calls
   * (after the user funds the executive) ignore `mode` and resume
   * from `pending_register`.
   */
  mode?: 'generate' | 'import';
  /**
   * Required when `mode === 'import'`. The executive's 64-byte
   * ed25519 secret key, base58-encoded. The host validates the
   * length + curve before persisting and never echoes the secret
   * back in any tool response.
   */
  executive_secret_base58?: string;
};

export type GetIdentityArgs = Record<string, never>;

export type ReceiptsArgs = {
  /** Filter by direction. `'both'` returns spend + earn receipts. */
  direction?: 'both' | 'outgoing' | 'incoming';
  /** Max items to return. Capped server-side. */
  limit?: number;
};

export type DiscoverArgs = {
  /** Free-text capability label (e.g. "ocr", "weather"). */
  capability?: string;
  /** Maximum decimal USDC price per call. */
  max_price_usdc?: number;
  /** Pricing-type filter. */
  pricing_type?: 'free' | 'per_call' | 'variable';
  /**
   * Restrict to a single catalogue:
   *   - `'leash'`: agents listed on the Leash marketplace.
   *   - `'pay-skills'`: providers in the Solana Foundation
   *     `pay-skills` registry.
   *   - `'all'` (default): merged.
   */
  source?: 'leash' | 'pay-skills' | 'all';
  /** Max items to return. Server-capped. */
  limit?: number;
};

export type ReputationArgs = {
  agent_mint: string;
  network?: SvmNetwork;
};

/**
 * Inputs for `leash_pay_skills_endpoints` — expand a chosen
 * `pay-skills` provider (returned by `leash_discover`) into its
 * paid endpoint list. Mirrors `pay skills endpoints <fqn>` from the
 * pay.sh CLI.
 */
export type PaySkillsProviderArgs = {
  /**
   * Fully-qualified provider name as published in the catalogue.
   * Two- or three-segment paths, e.g. `agentmail/email` or
   * `coinbase-cdp/coinbase-developer-platform/baseSepoliaWalletApi`.
   * Lift this verbatim from a `leash_discover` item that has
   * `source === 'pay-skills'` (the FQN lives in `slug`).
   */
  fqn: string;
};

/**
 * Inputs for `leash_set_spend_limit`. Lets the owner change the cap
 * the agent treasury PDA delegates to the executive keypair for an
 * SPL stable. `unlimited` writes `u64::MAX`; `revoke` zeros the
 * delegation; an explicit decimal amount sets that cap (in
 * human-readable units of the token).
 */
export type SetSpendLimitArgs = {
  /** SPL stable to update the delegation for. Defaults to USDC. */
  symbol?: StableSymbol;
  /**
   * What to write.
   *   - `'unlimited'` (default) — `u64::MAX`, the protocol default.
   *   - `'revoke'` — drop the delegation; the executive can no
   *     longer move funds from the treasury until re-approved.
   *   - `'amount'` — set a custom cap from `amount`.
   */
  mode?: 'unlimited' | 'revoke' | 'amount';
  /**
   * Required when `mode === 'amount'`. Decimal amount in
   * human-readable units of the token (e.g. `100` = $100 USDC).
   * Server applies the mint's `decimals` before broadcasting.
   */
  amount?: number;
};

/**
 * Inputs for `leash_get_spend_limit`. No knobs beyond the symbol —
 * the host already knows the agent + network from session state.
 */
export type GetSpendLimitArgs = {
  /** SPL stable to inspect. Defaults to USDC. */
  symbol?: StableSymbol;
};

/**
 * Inputs for `leash_get_receipt`. Looks up one ReceiptV1 by its
 * deterministic `receipt_hash` (the same hash the explorer URL
 * carries: `/receipt/{hash}`). Network is host-bound so a hash from
 * the sibling cluster returns `not_found`.
 */
export type GetReceiptArgs = {
  /** 64-hex-char receipt_hash from the seller-side ReceiptV1. */
  receipt_hash: string;
};

/**
 * Inputs for `leash_transaction_history`. Lists every receipt for the
 * active agent within the last `days` days, both directions by
 * default. The host paginates the underlying `/v1/receipts/{agent}`
 * feed and trims to the day window client-side.
 */
export type TransactionHistoryArgs = {
  /** Window size in days (1 ≤ N ≤ 90). Defaults to 7. */
  days?: number;
  /** Filter by direction. Defaults to `both`. */
  direction?: 'both' | 'outgoing' | 'incoming';
  /** Hard cap on the total receipts returned (default 200, max 1000). */
  limit?: number;
};

/**
 * Inputs for `leash_daily_transactions`. Same window as
 * `transaction_history` but the host bins receipts by UTC ingest
 * date and returns per-day aggregates (count + USD-equivalent sums)
 * plus grand totals. Stables (USDC/USDG/USDT) are summed as USD 1:1.
 */
export type DailyTransactionsArgs = {
  /** Window size in days (1 ≤ N ≤ 90). Defaults to 7. */
  days?: number;
};

// ────────────────────────────────────────────────────────────────────────────
// LeashHost
// ────────────────────────────────────────────────────────────────────────────

export interface LeashHost {
  /** The agent's MPL Core asset address. `null` while the user is in onboarding. */
  agentMint: string | null;

  /** Pubkey of the wallet that owns the agent (Privy embedded wallet OR local executive). */
  ownerWallet: string | null;

  /** Cluster the agent is registered on. */
  network: SvmNetwork;

  /** RPC URL the host's tools should use for direct chain reads. */
  rpcUrl: string;

  /** Base URL of the Leash API (`https://api.leash.market` in prod). */
  apiBaseUrl: string;

  /**
   * Mint a real x402 payment link. Implementations decide how the call
   * authenticates with the Leash API (chat product reveals a stored
   * platform API key; standalone MCP signs an X-Leash-Sig header).
   */
  createPaymentLink(args: CreatePaymentLinkArgs): Promise<LeashToolResult>;

  /**
   * Pay an x402 link.
   *   - chat product impl: probes the URL, returns a `payment_request`
   *     artifact for the UI to settle.
   *   - standalone MCP impl: probes, signs, settles, and returns the
   *     `payment_receipt` blob with the on-chain signature.
   */
  pay(args: PayArgs): Promise<LeashToolResult>;

  /**
   * Withdraw SOL or an SPL stable from the agent treasury.
   *   - chat product impl: validates + returns a `withdraw_request`
   *     artifact for the UI.
   *   - standalone MCP impl: actually constructs and signs the
   *     `mpl-core::Execute` instruction with the local owner key.
   */
  withdraw(args: WithdrawArgs): Promise<LeashToolResult>;

  /**
   * Read the agent treasury balance. Both surfaces return the same
   * shape (network/RPC reads are host-agnostic).
   */
  checkTreasuryBalance(args: CheckTreasuryBalanceArgs): Promise<LeashToolResult>;

  /**
   * Provision a new on-chain agent for the caller.
   *   - standalone MCP impl: hits `POST /v1/sandbox/agent` (devnet),
   *     writes `~/.config/leash/agent.json` with the returned secret,
   *     returns the funding details.
   *   - chat product impl: returns a `kind: 'register_agent', status:
   *     'manual'` blob telling the model to direct the user to
   *     "Profile → Agent" (the chat UI handles minting today).
   */
  registerAgent(args: RegisterAgentArgs): Promise<LeashToolResult>;

  /**
   * Self-introspection — what agent am I, what's my network, who's
   * the executive. Both impls read from local context and never hit
   * the network. Cheap by design so the LLM can call it freely.
   */
  getIdentity(args: GetIdentityArgs): Promise<LeashToolResult>;

  /**
   * List recent receipts for the active agent. Both impls call the
   * Leash API; the standalone host uses the legacy API-key bearer
   * until X-Leash-Sig auth lands in batch 6.
   */
  receipts(args: ReceiptsArgs): Promise<LeashToolResult>;

  /**
   * Search the Leash marketplace for paid services by capability +
   * price. Public — both hosts hit `GET /v1/discover` directly.
   */
  discover(args: DiscoverArgs): Promise<LeashToolResult>;

  /**
   * Pull the live reputation snapshot for any on-chain agent. Public
   * — both hosts hit `GET /v1/agents/:mint/reputation` directly.
   */
  reputation(args: ReputationArgs): Promise<LeashToolResult>;

  /**
   * Expand a `pay-skills` discover item into its paid endpoints.
   * Public — hits `GET /v1/discover/pay-skills/:fqn` directly. The
   * returned `endpoint_urls[]` are absolute URLs the agent can pay
   * via `pay()` without any extra plumbing.
   */
  paySkillsProvider(args: PaySkillsProviderArgs): Promise<LeashToolResult>;

  /**
   * Owner-driven update of the SPL `Approve` delegation that lets
   * the executive spend stables out of the agent treasury PDA.
   * Standalone MCP / CLI signs the `mpl-core::Execute(SPL.Approve|Revoke)`
   * tx with the local owner key; chat product returns a
   * `kind: 'spend_limit', status: 'manual'` artifact pointing the
   * user at the Profile → Agent UI.
   */
  setSpendLimit(args: SetSpendLimitArgs): Promise<LeashToolResult>;

  /**
   * Read the current delegation + treasury balance for an SPL stable.
   * Cheap — host-agnostic RPC read. Returns delegate pubkey,
   * delegated atomic amount + decimal-formatted version, and current
   * balance.
   */
  getSpendLimit(args: GetSpendLimitArgs): Promise<LeashToolResult>;

  /**
   * Look up a single receipt by its `receipt_hash`. Returns the full
   * ReceiptV1 (the same JSON the explorer renders at
   * `/receipt/{hash}`) plus a few convenience fields the LLM can
   * inline into a reply (explorer URL, direction, ingested_at).
   */
  getReceipt(args: GetReceiptArgs): Promise<LeashToolResult>;

  /**
   * List every receipt for the active agent within the last `days`
   * days, both directions by default. The host paginates the
   * underlying `/v1/receipts/{agent}` feed and trims to the window
   * client-side. Returns the receipts plus running USD totals.
   */
  transactionHistory(args: TransactionHistoryArgs): Promise<LeashToolResult>;

  /**
   * Bin the same receipts as `transactionHistory` by UTC ingest date
   * and return per-day aggregates (count + USD-equivalent sums for
   * each direction) plus grand totals. Useful for "show me last
   * week's revenue" style prompts.
   */
  dailyTransactions(args: DailyTransactionsArgs): Promise<LeashToolResult>;
}
