/**
 * Live devnet sanity check for the standalone `@leash/mcp` server.
 *
 * Boots the in-memory MCP transport, calls `leash_check_treasury_balance`
 * via the protocol, and prints the raw JSON result. Use this when you
 * want to confirm the path
 *
 *   `cli.ts -> server.ts -> StdioHost.checkTreasuryBalance ->
 *      @leash/core::listSplBalances -> RPC`
 *
 * works against a real agent before recording the YC demo. Requires:
 *
 *   LEASH_AGENT_MINT       — a real on-chain agent (from `pnpm --filter
 *                            @leash/api test:self-register-devnet` for
 *                            example)
 *   LEASH_EXECUTIVE_KEY    — that agent's owner secret (base58 OR JSON
 *                            array). The check itself doesn't need the
 *                            secret, but the host loader rejects a
 *                            missing one — just supply any valid 64-byte
 *                            keypair if you only want to test reads.
 *   LEASH_NETWORK          — solana-devnet (default) or solana-mainnet
 *
 * Usage:
 *
 *   LEASH_AGENT_MINT=<mint> LEASH_EXECUTIVE_KEY=<base58|json> \
 *     pnpm --filter @leash/mcp dev:demo-balance
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { buildServerFromEnv } from '../src/server.js';

async function main(): Promise<void> {
  const { server, config } = buildServerFromEnv({});
  if (!config) {
    process.stderr.write(
      `[demo-balance] no agent configured — set LEASH_AGENT_MINT + LEASH_EXECUTIVE_KEY in the env\n`,
    );
    process.exit(2);
  }
  process.stderr.write(
    `[demo-balance] mint=${config.agentMint} network=${config.network} rpc=${config.rpcUrl}\n`,
  );

  const [serverT, clientT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'leash-demo-balance', version: '0.0.1' }, { capabilities: {} });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  const list = await client.listTools();
  process.stderr.write(`[demo-balance] tools: ${list.tools.map((t) => t.name).join(', ')}\n`);

  const result = await client.callTool({
    name: 'leash_check_treasury_balance',
    arguments: {},
  });
  const content = result.content as Array<{ type: string; text: string }> | undefined;
  if (!content || content.length === 0) {
    throw new Error('tool returned no content');
  }
  const parsed = JSON.parse(content[0]!.text);
  // Print result on STDOUT so callers can pipe it into jq.
  process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);

  await client.close();
  await server.close();
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[demo-balance] failed: ${msg}\n`);
  process.exit(1);
});
