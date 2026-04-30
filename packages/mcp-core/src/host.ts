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
}
