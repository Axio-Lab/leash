import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'Optional human-readable agent name (recorded in MPL Core metadata). Defaults to `Agent <executive_pubkey[0..8]>`.',
    ),
  mode: z
    .enum(['generate', 'import'])
    .optional()
    .describe(
      'Owner-keypair source. `generate` (default) creates a fresh keypair; `import` accepts an existing one via `executive_secret_base58`. Only consulted on the first call — subsequent calls resume from the persisted `pending_register` block.',
    ),
  executive_secret_base58: z
    .string()
    .min(32)
    .max(120)
    .optional()
    .describe(
      'Required when `mode: "import"`. Caller-supplied 64-byte ed25519 secret key, base58-encoded. Validated and persisted to `~/.config/leash/agent.json` (chmod 600); never echoed back in any tool response.',
    ),
});

export const registerAgentTool = defineTool({
  name: 'leash_register_agent',
  description: [
    'Provision a new on-chain agent for the caller. Two-step flow — call this tool TWICE.',
    'Network is taken from the MCP host config (`LEASH_NETWORK`) and applies to both devnet + mainnet.',
    'Step 1 (first call): host either generates a fresh executive keypair or imports the one in `executive_secret_base58`. The executive pubkey is persisted to `~/.config/leash/agent.json` and the tool returns `status: "funding_required"` with the pubkey, the SOL amount needed (rent + tx fees), and the network. SHOW the user the pubkey + amount and ask them to send SOL to that address.',
    'Step 2 (after the user funds): call this tool again with NO arguments. The host checks the executive balance, mints the MPL Core agent, sets unlimited USDC spend delegation to the executive, records the asset on the API, and persists the final config. Returns `status: "ok"` with mint, treasury, and Solscan URLs.',
    'If the user already minted, the tool short-circuits with `status: "already_registered"`.',
    'In the chat-product runtime this tool returns `status: "manual"` and points the user at the Profile → Agent UI (chat mints via Privy, not via MCP).',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.registerAgent(args),
});
