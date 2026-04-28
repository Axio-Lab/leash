export type Capability = {
  slug: string | null;
  endpoint: string;
  tools: string[];
  paid?: boolean;
};

export type Agent = {
  mint: string;
  name: string;
  ownerWallet: string;
  network: 'solana-devnet' | 'solana-mainnet';
  model: string;
  systemPrompt: string;
  capabilities: Capability[];
  budget: { perAction: string; perTask: string; perDay: string };
  treasury: string;
  encryptedLlmKey: string;
  llmProvider: 'anthropic' | 'openai';
};

export type Task = {
  id: string;
  agentMint: string;
  prompt: string;
  budgetCap: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'out_of_budget';
  spent: string;
};

export type ActivityType = 'think' | 'tool_call' | 'payment' | 'tool_result' | 'done' | 'error';

export type ActivityEnvelope = {
  id: string;
  taskId: string;
  agentMint: string;
  type: ActivityType;
  payload: Record<string, unknown>;
  costUsdc: string | null;
  receiptId: string | null;
  createdAt: string;
};
