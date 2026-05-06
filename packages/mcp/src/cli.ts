#!/usr/bin/env node
/**
 * `@leashmarket/mcp` CLI entry point.
 *
 * Subcommands:
 *
 *   leash-mcp                       Default — run the STDIO MCP server.
 *                                   Hosts (Cursor, Claude Desktop, Cline,
 *                                   Continue, ChatGPT-MCP) wire this up
 *                                   via:
 *
 *                                     {
 *                                       "mcpServers": {
 *                                         "leash": {
 *                                           "command": "npx",
 *                                           "args": ["-y", "@leashmarket/mcp"]
 *                                         }
 *                                       }
 *                                     }
 *
 *   leash-mcp export [--out <path>] Print or save the active agent.json
 *                                   so the same identity can be moved
 *                                   into another host (or the chat product
 *                                   via Profile → Agent → Import).
 *
 *   leash-mcp import <path>         Copy a JSON agent config into the
 *                                   default location (~/.config/leash/agent.json).
 *                                   This is how an agent minted in the
 *                                   chat product (or downloaded from
 *                                   another machine) becomes the local
 *                                   default.
 *
 *   leash-mcp doctor                Print a quick diagnostic — config
 *                                   path, agent mint, executive pubkey,
 *                                   network, RPC reachability, API
 *                                   reachability. Useful for the demo
 *                                   sanity check.
 *
 * On any boot path we never throw — the goal is the LLM never sees a
 * tool exception. STDIO server logs go to stderr; subcommands print
 * to stdout.
 */

import { readFileSync, statSync } from 'node:fs';
import { mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { defaultConfigPath, loadAgentConfig } from './config.js';
import { writeAgentConfig } from './config-write.js';
import { runStdioServer } from './server.js';
import { loadSigner } from './signer.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case undefined:
    case 'serve':
    case 'run':
      await runStdioServer();
      return;

    case 'export':
      await runExport(argv.slice(1));
      return;

    case 'import':
      await runImport(argv.slice(1));
      return;

    case 'doctor':
      await runDoctor();
      return;

    case '-h':
    case '--help':
    case 'help':
      printHelp();
      return;

    case '-v':
    case '--version':
      printVersion();
      return;

    default:
      process.stderr.write(`unknown command: ${cmd}\n\n`);
      printHelp();
      process.exit(2);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[leash-mcp] fatal: ${msg}\n`);
  process.exit(1);
});

// ────────────────────────────────────────────────────────────────────────────
// export
// ────────────────────────────────────────────────────────────────────────────

async function runExport(args: string[]): Promise<void> {
  const config = loadAgentConfig();
  if (!config) {
    process.stderr.write(
      'no agent configured. Run `leash-mcp` and call `leash_register_agent`, or set LEASH_AGENT_MINT + LEASH_EXECUTIVE_KEY first.\n',
    );
    process.exit(1);
  }

  const file = {
    version: 1 as const,
    agent_mint: config.agentMint,
    executive_keypair: config.executiveSecretBase58,
    network: config.network,
    api_url: config.apiBaseUrl,
    rpc_url: config.rpcUrl,
    ...(config.apiKey ? { api_key: config.apiKey } : {}),
    exported_at: new Date().toISOString(),
  };
  const body = `${JSON.stringify(file, null, 2)}\n`;

  const outFlag = args.indexOf('--out');
  if (outFlag !== -1 && args[outFlag + 1]) {
    const outPath = args[outFlag + 1]!;
    await mkdir(dirname(outPath), { recursive: true, mode: 0o700 });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outPath, body, { mode: 0o600 });
    process.stderr.write(`exported to ${outPath} (chmod 600)\n`);
    return;
  }
  process.stdout.write(body);
}

// ────────────────────────────────────────────────────────────────────────────
// import
// ────────────────────────────────────────────────────────────────────────────

async function runImport(args: string[]): Promise<void> {
  const src = args[0];
  if (!src) {
    process.stderr.write('usage: leash-mcp import <path-to-agent.json>\n');
    process.exit(2);
  }
  let stat;
  try {
    stat = statSync(src);
  } catch {
    process.stderr.write(`cannot read ${src}\n`);
    process.exit(1);
  }
  if (!stat.isFile()) {
    process.stderr.write(`${src} is not a regular file\n`);
    process.exit(1);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(src, 'utf8'));
  } catch (err) {
    process.stderr.write(`${src} is not valid JSON: ${(err as Error).message}\n`);
    process.exit(1);
  }
  if (!parsed || typeof parsed !== 'object') {
    process.stderr.write(`${src} is not an object\n`);
    process.exit(1);
  }
  const f = parsed as Record<string, unknown>;
  const agentMint = typeof f.agent_mint === 'string' ? f.agent_mint : undefined;
  const executiveKey = typeof f.executive_keypair === 'string' ? f.executive_keypair : undefined;
  if (!agentMint || !executiveKey) {
    process.stderr.write('config missing required fields: agent_mint, executive_keypair\n');
    process.exit(1);
  }
  // Validate the executive secret decodes to a real ed25519 keypair
  // before clobbering the on-disk config — otherwise we'd silently
  // brick the user's setup.
  try {
    loadSigner(executiveKey);
  } catch (err) {
    process.stderr.write(`executive_keypair invalid: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const network = f.network === 'solana-devnet' ? 'solana-devnet' : ('solana-mainnet' as const);
  const apiBaseUrl =
    typeof f.api_url === 'string' && f.api_url.length > 0 ? f.api_url : 'https://api.leash.market';
  const rpcUrl =
    typeof f.rpc_url === 'string' && f.rpc_url.length > 0
      ? f.rpc_url
      : network === 'solana-mainnet'
        ? 'https://api.mainnet-beta.solana.com'
        : 'https://api.devnet.solana.com';
  const explorerBaseUrl =
    typeof f.explorer_url === 'string' && f.explorer_url.length > 0
      ? f.explorer_url
      : 'https://explorer.leash.market';
  const apiKey = typeof f.api_key === 'string' ? f.api_key : null;

  const target = defaultConfigPath();
  await writeAgentConfig({
    config: {
      agentMint,
      executiveSecretBase58: executiveKey,
      network,
      apiBaseUrl,
      rpcUrl,
      explorerBaseUrl,
      apiKey,
    },
    path: target,
  });
  // Also copy as a backup so the user has the original.
  try {
    await mkdir(dirname(`${target}.backup`), { recursive: true, mode: 0o700 });
    await copyFile(src, `${target}.backup`);
  } catch {
    /* best-effort backup */
  }
  process.stdout.write(`imported ${agentMint} (network=${network}) → ${target}\n`);
}

// ────────────────────────────────────────────────────────────────────────────
// doctor
// ────────────────────────────────────────────────────────────────────────────

async function runDoctor(): Promise<void> {
  const path = defaultConfigPath();
  const config = loadAgentConfig();

  const lines: string[] = [];
  lines.push(`config_path: ${path}`);
  if (!config) {
    lines.push(`status: no_agent (call \`leash_register_agent\` from any MCP host)`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }

  let executivePubkey = '<unknown>';
  try {
    executivePubkey = loadSigner(config.executiveSecretBase58).pubkey;
  } catch (err) {
    lines.push(`status: error — executive secret invalid: ${(err as Error).message}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return;
  }

  lines.push(`agent_mint: ${config.agentMint}`);
  lines.push(`executive_pubkey: ${executivePubkey}`);
  lines.push(`network: ${config.network}`);
  lines.push(`api_base_url: ${config.apiBaseUrl}`);
  lines.push(`rpc_url: ${config.rpcUrl}`);
  lines.push(`explorer_url: ${config.explorerBaseUrl}`);
  lines.push(`api_key: ${config.apiKey ? `set (${config.apiKey.slice(0, 8)}…)` : 'unset'}`);

  // RPC reachability — best-effort getVersion JSON-RPC ping.
  lines.push(`rpc_check: ${await pingRpc(config.rpcUrl)}`);
  // API reachability — GET /v1/discover (public, cheap).
  lines.push(`api_check: ${await pingApi(config.apiBaseUrl)}`);

  if (isPublicRpc(config.rpcUrl)) {
    lines.push('');
    lines.push('⚠  rpc_url points at the public Solana RPC. Settlement (`leash_pay_payment_link`)');
    lines.push('   makes 3-5 RPC calls and the public endpoint is rate-limited (429s) and slow');
    lines.push('   (4-8s per pay). Set LEASH_RPC_URL or `rpc_url` in agent.json to a Helius /');
    lines.push('   Triton / QuickNode / Alchemy / self-hosted endpoint. See:');
    lines.push('     https://docs.leash.market/agents/mcp#bring-your-own-rpc');
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * Returns true when the configured RPC is one of the public Solana
 * defaults baked into `config.ts`. Used by `doctor` to surface a
 * latency warning. Matches host-only — query strings are stripped so
 * `?api-key=…` overrides are correctly recognised as private.
 */
function isPublicRpc(rpcUrl: string): boolean {
  try {
    const u = new URL(rpcUrl);
    const host = u.host.toLowerCase();
    return host === 'api.devnet.solana.com' || host === 'api.mainnet-beta.solana.com';
  } catch {
    return false;
  }
}

async function pingRpc(rpcUrl: string): Promise<string> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getVersion' }),
    });
    if (!res.ok) return `error (HTTP ${res.status})`;
    const json = (await res.json()) as { result?: { 'solana-core'?: string } };
    return `ok (solana-core=${json.result?.['solana-core'] ?? 'unknown'})`;
  } catch (err) {
    return `error (${(err as Error).message})`;
  }
}

async function pingApi(apiBaseUrl: string): Promise<string> {
  try {
    const url = `${apiBaseUrl.replace(/\/+$/, '')}/v1/discover?limit=1`;
    const res = await fetch(url);
    return `ok (HTTP ${res.status})`;
  } catch (err) {
    return `error (${(err as Error).message})`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// help / version
// ────────────────────────────────────────────────────────────────────────────

function printHelp(): void {
  process.stdout.write(
    [
      'usage: leash-mcp [command] [options]',
      '',
      'commands:',
      '  (default)         run the STDIO MCP server (alias: serve, run)',
      '  export            print active agent.json to stdout (or --out <path>)',
      '  import <path>     install a downloaded agent.json into ~/.config/leash/',
      '  doctor            diagnostic — config + RPC + API reachability',
      '  help, -h          show this message',
      '  version, -v       show installed version',
      '',
      'environment overrides:',
      '  LEASH_AGENT_MINT, LEASH_EXECUTIVE_KEY, LEASH_NETWORK,',
      '  LEASH_API_URL, LEASH_RPC_URL, LEASH_API_KEY',
      '',
      'see https://leash.market/docs/mcp for setup details.',
      '',
    ].join('\n'),
  );
}

function printVersion(): void {
  process.stdout.write('@leashmarket/mcp 0.1.0\n');
}
