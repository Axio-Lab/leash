import { z } from 'zod';

import { defineTool } from '../tool.js';

const inputSchema = z.object({});

export const getIdentityTool = defineTool({
  name: 'leash_get_identity',
  description: [
    'Self-introspection. Returns the active agent mint, treasury PDA, executive pubkey, network, and Leash API base URL the agent is talking to.',
    'Cheap by design — no network roundtrips. Call freely whenever the LLM needs to remind itself who it is or which network it operates on (avoids guessing about devnet vs mainnet for explorer URLs).',
    'Returns `{ status: "no_agent" }` when the host has no agent provisioned yet — pair with `leash_register_agent` to fix.',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.getIdentity(args),
});
