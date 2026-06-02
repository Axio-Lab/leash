export type KoraToolName =
  | 'kora_get_agent_capabilities'
  | 'kora_get_balance'
  | 'kora_list_banks'
  | 'kora_resolve_bank_account'
  | 'kora_create_payout'
  | 'kora_get_payout_status'
  | 'kora_list_payouts'
  | 'kora_create_checkout'
  | 'kora_create_virtual_account'
  | 'kora_credit_sandbox_virtual_account';

export type KoraAgentCapability = {
  name: KoraToolName;
  title: string;
  description: string;
  endpoint: string;
  localCurrency: boolean;
  moneyMovement: boolean;
};

export type CallerSelector = {
  mint?: string;
  handle?: string;
  domain?: string;
};

export type CallerTrust = {
  status: 'public' | 'missing' | 'verified' | 'denied' | 'error';
  verified: boolean;
  selector: CallerSelector | null;
  resolvedMint: string | null;
  detail: string;
  raw?: unknown;
};

export type KoraAgentPolicy = {
  allowedCapabilities: KoraToolName[];
  allowedCurrencies: string[];
  requireVerifiedAgent: boolean;
  allowedCallers: {
    mints: string[];
    handles: string[];
    domains: string[];
  };
  maxPayoutAmount: number;
  dailyPayoutLimit: number;
  approvalThreshold: number;
};

export type KoraAgent = {
  id: string;
  name: string;
  description: string;
  policy: KoraAgentPolicy;
  capabilities: KoraAgentCapability[];
  createdAt: string;
  updatedAt: string;
};

export type PolicyDecision = {
  status: 'allowed' | 'denied' | 'approval_required';
  reason: string;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
};

export type KoraExecution = {
  id: string;
  agentId: string;
  tool: KoraToolName;
  status: 'ok' | 'denied' | 'approval_required' | 'error' | 'webhook_updated';
  amount: number | null;
  currency: string | null;
  caller: CallerTrust;
  decision: PolicyDecision;
  koraReference: string | null;
  receiptHash: string;
  request: unknown;
  response: unknown;
  createdAt: string;
  updatedAt: string;
};

export type KoraReceipt = {
  kind: 'kora_agent_rail_receipt';
  receipt_hash: string;
  agent_id: string;
  tool: KoraToolName;
  decision: PolicyDecision['status'];
  amount: number | null;
  currency: string | null;
  caller: {
    selector: CallerSelector | null;
    resolved_mint: string | null;
    trust_status: CallerTrust['status'];
  };
  kora_reference: string | null;
  timestamp: string;
};

export type KoraToolResult = {
  kind: 'kora_tool_result';
  status: 'ok' | 'denied' | 'approval_required' | 'error';
  agent_id: string;
  tool: KoraToolName;
  decision: PolicyDecision;
  receipt: KoraReceipt;
  data?: unknown;
  error?: { message: string };
};
