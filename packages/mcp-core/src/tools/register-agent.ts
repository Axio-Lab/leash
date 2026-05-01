import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('Optional human-readable agent name (recorded in MPL Core metadata).'),
  network: z
    .enum(['solana-devnet', 'solana-mainnet'])
    .optional()
    .describe('Cluster to register the agent on. Defaults to `solana-devnet` (auto-funded).'),
});

export const registerAgentTool = defineTool({
  name: 'leash_register_agent',
  description: [
    'Provision a brand-new on-chain agent for the caller. First-run tool — call ONCE per host.',
    'Standalone MCP / CLI runtime: mints an MPL Core asset on devnet and auto-funds the treasury with $1 USDC + 0.01 SOL via the Leash sandbox faucet. Persists the executive keypair to `~/.config/leash/agent.json` (chmod 600) so subsequent tool calls work without re-authentication.',
    'Chat-product runtime: returns a `status: "manual"` instruction telling the user to mint via Profile → Agent (the chat UI owns minting today).',
    'Returns the agent mint, treasury address, executive pubkey, funding amounts, and Solscan URL. On `status: "ok"`, surface the mint + funding details + explorer link in your reply so the user can verify on-chain immediately.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.registerAgent(args),
});
