import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({
  token: z
    .enum(['SOL', 'USDC', 'USDG', 'USDT'])
    .describe('Token to withdraw. SOL for native lamports; otherwise an SPL stable.'),
  amount: z
    .number()
    .positive()
    .describe('Amount in whole units (e.g. 100 for 100 USDC, 0.5 for 0.5 SOL). Positive only.'),
  destination: z
    .string()
    .min(32)
    .max(44)
    .describe(
      "Recipient Solana wallet address (base58). Must NOT be the treasury itself; it's the destination wallet, not its ATA.",
    ),
});

export const withdrawTreasuryTool = defineTool({
  name: 'leash_withdraw_treasury',
  description: [
    'Withdraw SOL or an SPL stable (USDC/USDG/USDT) from the agent treasury to any Solana wallet.',
    'Behaviour depends on the host runtime:',
    '  - In the chat product the call DOES NOT settle on its own — only the asset owner (the user’s Privy wallet) can sign the on-chain `mpl-core::Execute`. It returns a `withdraw_request` artifact the chat UI renders as a Withdraw card; reply with one short sentence asking the user to approve.',
    '  - In the standalone MCP / CLI runtime the call SIGNS and SETTLES the withdrawal using the local executive keypair and returns a `withdraw_receipt` blob with the tx signature.',
    'On `status: "error"`, surface the `message` verbatim. Never claim a withdrawal completed and never invent a tx hash.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.withdraw(args),
});
