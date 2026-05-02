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
  description: z
    .string()
    .max(2048)
    .optional()
    .describe(
      'Free-text description recorded in the MPL Core asset and the EIP-8004 RegistrationV1 doc.',
    ),
  image_url: z
    .string()
    .url()
    .max(500)
    .optional()
    .describe(
      'Public URL of the agent profile image (e.g. an avatar / logo). Embedded as `image` in the EIP-8004 RegistrationV1 doc.',
    ),
  services: z
    .array(
      z.object({
        name: z
          .string()
          .min(1)
          .max(64)
          .describe('Short label, e.g. "web", "api", "docs", "support".'),
        endpoint: z
          .string()
          .url()
          .max(500)
          .describe('Fully-qualified URL of the service endpoint.'),
      }),
    )
    .max(32)
    .optional()
    .describe(
      'EIP-8004 RegistrationV1 `services[]` the agent advertises. Threaded into the on-chain MPL Core metadata, the off-chain RegistrationV1 doc, and the platform `services` column. Persisted in `pending_register` so the SECOND call (after funding) keeps them. The Leash protocol auto-injects a `receipts` service — do NOT supply one.',
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
    'BEFORE Step 1: ask the user for the agent\'s `name` (required), `description` (recommended), `image_url` (optional avatar), and `services[]` — the EIP-8004 service endpoints the agent will advertise (e.g. `[{ name: "web", endpoint: "https://my-agent.xyz" }, { name: "api", endpoint: "https://api.my-agent.xyz" }]`). Services let other agents and humans discover what this agent does and where to reach it. Skip the `services` arg only if the user has nothing to advertise yet — they can update later. Do NOT supply a `receipts` service; Leash auto-injects one.',
    'Step 1 (first call): pass `name` + `description` + `image_url` + `services` together with `mode` (default `generate`, or `import` with `executive_secret_base58`). The host either generates a fresh executive keypair or imports the supplied one. The keypair AND the agent metadata (name/description/image/services) are persisted to `~/.config/leash/agent.json` under `pending_register`. The tool returns `status: "funding_required"` with the executive pubkey, the SOL amount needed (rent + tx fees), and the network. SHOW the user the pubkey + amount and ask them to send SOL to that address.',
    'Step 2 (after the user funds): call this tool again with NO arguments. The host checks the executive balance, mints the MPL Core agent with the persisted name/description/image/services, sets unlimited USDC spend delegation to the executive, records the asset on the API (with the same services list), and persists the final config. Returns `status: "ok"` with mint, treasury, and Solscan URLs.',
    'If the user already minted, the tool short-circuits with `status: "already_registered"`.',
    'In the chat-product runtime this tool returns `status: "manual"` and points the user at the Profile → Agent UI (chat mints via Privy, not via MCP).',
  ].join(' '),
  inputSchema,
  handler: async (args, ctx) => ctx.registerAgent(args),
});
