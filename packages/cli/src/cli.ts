#!/usr/bin/env node
/**
 * `leash` — human-driven Leash CLI.
 *
 * Wraps the same `LeashHost` that `@leash/mcp` exposes to AI agents,
 * but skips the MCP wire protocol and renders results as plain text
 * (or `--json` when machine-readable output is wanted). Designed to
 * be the "git/gh/aws" of the Leash agent economy: a small, fast tool
 * for humans who want to inspect or operate their agent without
 * spinning up a chat product or MCP host.
 *
 * Subcommands
 * -----------
 *   leash agent create [--name N]   Mint a sandbox agent (devnet, auto-funded).
 *   leash agent show                Print active agent identity.
 *   leash agent export [--out P]    Export agent.json (alias for `leash-mcp export`).
 *   leash agent import <path>       Install agent.json (alias for `leash-mcp import`).
 *   leash treasury balance          List SOL + USDC/USDG/USDT balances.
 *   leash treasury withdraw …       Owner-driven on-chain withdrawal.
 *   leash discover [-q QUERY] …     Marketplace search (public).
 *   leash reputation <agent_mint>   Reputation snapshot (public).
 *   leash receipts [--limit N]      Recent receipts for the active agent.
 *   leash pay <link-url> [--max …]  Pay an x402 paywall.
 *   leash doctor                    Config + RPC + API reachability check.
 *   leash help / -h                 Full help.
 *   leash version / -v              Show installed version.
 *
 * Output mode
 * -----------
 * Each command prints a one-line summary by default; pass `--json` to
 * get the raw `LeashToolResult` payload (same shape the MCP tools
 * return) for piping into `jq`, scripts, etc.
 */

import { HostRef, buildServerFromEnv } from '@leash/mcp';
import type { LeashHost, LeashToolResult } from '@leash/mcp-core';

const VERSION = '0.1.0';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      printHelp();
      return;

    case 'version':
    case '-v':
    case '--version':
      process.stdout.write(`leash ${VERSION}\n`);
      return;

    case 'agent':
      await runAgent(argv.slice(1));
      return;

    case 'treasury':
      await runTreasury(argv.slice(1));
      return;

    case 'discover':
      await runDiscover(argv.slice(1));
      return;

    case 'reputation':
      await runReputation(argv.slice(1));
      return;

    case 'receipts':
      await runReceipts(argv.slice(1));
      return;

    case 'pay':
      await runPay(argv.slice(1));
      return;

    case 'doctor':
      await runDoctor(argv.slice(1));
      return;

    default:
      process.stderr.write(`unknown command: ${cmd}\n\n`);
      printHelp();
      process.exit(2);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`leash: fatal: ${msg}\n`);
  process.exit(1);
});

// ────────────────────────────────────────────────────────────────────────────
// agent
// ────────────────────────────────────────────────────────────────────────────

async function runAgent(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'create':
      await runAgentCreate(args.slice(1));
      return;
    case 'show':
      await runAgentShow(args.slice(1));
      return;
    case 'export':
    case 'import': {
      // Defer to leash-mcp via a child process — no point in
      // duplicating the file I/O.
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync('leash-mcp', [sub, ...args.slice(1)], {
        stdio: 'inherit',
      });
      process.exit(result.status ?? 0);
    }
    default:
      process.stderr.write('usage: leash agent {create|show|export|import}\n');
      process.exit(2);
  }
}

async function runAgentCreate(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const nameIdx = args.indexOf('--name');
  const name = nameIdx !== -1 ? args[nameIdx + 1] : undefined;

  const result = await hostRef.registerAgent({ ...(name ? { name } : {}) });
  printResult(result, json, (payload) => {
    if (payload.status === 'already_registered') {
      return `agent ${payload.agent_mint} already configured`;
    }
    if (payload.status === 'ok') {
      return [
        `agent created: ${payload.agent_mint}`,
        `  treasury:        ${payload.treasury_address}`,
        `  executive:       ${payload.executive_pubkey}`,
        `  network:         ${payload.network}`,
        `  funded:          ${payload.funded_with?.usdc_atomic ?? 0} USDC atomic + ${payload.funded_with?.sol_lamports ?? 0} lamports`,
        `  config:          ${payload.config_written_to ?? '(not persisted)'}`,
        `  explorer:        ${payload.explorer_url}`,
      ].join('\n');
    }
    return `error: ${payload.message ?? 'unknown'}`;
  });
}

async function runAgentShow(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const result = await hostRef.getIdentity({});
  printResult(result, json, (payload) => {
    if (payload.status === 'no_agent') return 'no agent configured (run `leash agent create`)';
    return [
      `agent_mint:       ${payload.agent_mint}`,
      `executive_pubkey: ${payload.executive_pubkey}`,
      `treasury:         ${payload.treasury_address}`,
      `network:          ${payload.network}`,
    ].join('\n');
  });
}

// ────────────────────────────────────────────────────────────────────────────
// treasury
// ────────────────────────────────────────────────────────────────────────────

async function runTreasury(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'balance':
      await runTreasuryBalance(args.slice(1));
      return;
    case 'withdraw':
      await runTreasuryWithdraw(args.slice(1));
      return;
    default:
      process.stderr.write('usage: leash treasury {balance|withdraw}\n');
      process.exit(2);
  }
}

async function runTreasuryBalance(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const result = await hostRef.checkTreasuryBalance({});
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    const lines = [`treasury: ${payload.treasury}`];
    lines.push(`  SOL:  ${payload.sol?.amount ?? '0'} (${payload.sol?.lamports ?? '0'} lamports)`);
    for (const t of payload.tokens ?? []) {
      lines.push(`  ${t.symbol ?? t.mint}: ${t.amount} (atomic ${t.atomic})`);
    }
    return lines.join('\n');
  });
}

async function runTreasuryWithdraw(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);

  const destination = optArg(args, '--to');
  const tokenRaw = optArg(args, '--token') ?? optArg(args, '--symbol');
  const amount = numArg(args, '--amount');

  if (!destination || amount == null || !tokenRaw) {
    process.stderr.write(
      'usage: leash treasury withdraw --to <wallet> --amount <decimal> --token SOL|USDC|USDG|USDT\n',
    );
    process.exit(2);
  }
  const token = tokenRaw.toUpperCase() as 'SOL' | 'USDC' | 'USDG' | 'USDT';

  const result = await hostRef.withdraw({ token, amount, destination });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    return [
      `withdraw ok`,
      `  amount:          ${asAny(payload).amount} ${asAny(payload).token ?? asAny(payload).symbol}`,
      `  destination:     ${asAny(payload).destination ?? asAny(payload).destination_wallet}`,
      `  tx_signature:    ${asAny(payload).tx_signature}`,
      `  explorer:        ${asAny(payload).explorer_url}`,
    ].join('\n');
  });
}

// ────────────────────────────────────────────────────────────────────────────
// discover / reputation / receipts / pay
// ────────────────────────────────────────────────────────────────────────────

async function runDiscover(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const query = {
    capability: optArg(args, '-q') ?? optArg(args, '--capability'),
    max_price_usdc: numArg(args, '--max-price'),
    pricing_type: optArg(args, '--pricing-type') as 'free' | 'per_call' | 'variable' | undefined,
    limit: numArg(args, '--limit'),
  };
  const cleaned = Object.fromEntries(
    Object.entries(query).filter(([, v]) => v !== undefined),
  ) as Parameters<LeashHost['discover']>[0];

  const result = await hostRef.discover(cleaned);
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    if (payload.count === 0) return 'no listings match';
    const lines = [`${payload.count} listing(s):`];
    for (const item of payload.items ?? []) {
      const price =
        item.pricing_type === 'free'
          ? 'free'
          : item.pricing_type === 'variable'
            ? 'variable'
            : `${item.price_usdc ?? '?'} USDC/call`;
      lines.push(`  • ${item.title} — ${price} — ${item.url}`);
      lines.push(`    ${item.description}`);
    }
    return lines.join('\n');
  });
}

async function runReputation(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const mint = args.find((a) => !a.startsWith('--'));
  if (!mint) {
    process.stderr.write(
      'usage: leash reputation <agent_mint> [--network solana-devnet|solana-mainnet]\n',
    );
    process.exit(2);
  }
  const network = optArg(args, '--network') as 'solana-devnet' | 'solana-mainnet' | undefined;
  const result = await hostRef.reputation({ agent_mint: mint, ...(network ? { network } : {}) });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    return [
      `agent ${payload.agent_mint} (${payload.network})`,
      `  rating:               ${payload.rating}`,
      `  settled_calls:        ${payload.settled_calls}`,
      `  denied_calls:         ${payload.denied_calls}`,
      `  total_volume_usdc:    ${payload.total_volume_usdc}`,
      `  distinct_counterparties: ${payload.distinct_counterparties}`,
      `  dispute_rate:         ${payload.dispute_rate}`,
      `  oldest_receipt_at:    ${payload.oldest_receipt_at ?? '(none)'}`,
    ].join('\n');
  });
}

async function runReceipts(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const limit = numArg(args, '--limit');
  const direction = optArg(args, '--direction') as 'both' | 'outgoing' | 'incoming' | undefined;
  const result = await hostRef.receipts({
    ...(limit ? { limit } : {}),
    ...(direction ? { direction } : {}),
  });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    if (!payload.items?.length) return 'no receipts yet';
    const lines = [`${payload.count} receipt(s):`];
    for (const r of payload.items) {
      lines.push(
        `  • ${r.timestamp}  ${r.direction.padEnd(8)}  ${r.decision.padEnd(6)}  ${r.amount ?? '?'} ${r.currency ?? ''}  ${r.tx_signature ?? '(no tx)'}`,
      );
    }
    return lines.join('\n');
  });
}

async function runPay(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const url = args.find((a) => /^https?:\/\//.test(a));
  if (!url) {
    process.stderr.write('usage: leash pay <link-url>\n');
    process.exit(2);
  }
  const result = await hostRef.pay({ url });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    return [
      `paid ${payload.amount} ${payload.currency} → ${payload.recipient}`,
      `  tx_signature:    ${payload.tx_signature}`,
      `  receipt_hash:    ${payload.receipt_hash}`,
      `  explorer:        ${payload.explorer_url}`,
    ].join('\n');
  });
}

async function runDoctor(_args: string[]): Promise<void> {
  // Defer to leash-mcp doctor for the heavy lifting.
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('leash-mcp', ['doctor'], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

// ────────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────────

function wantJson(args: string[]): boolean {
  return args.includes('--json');
}

function optArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  return args[i + 1];
}

function numArg(args: string[], flag: string): number | undefined {
  const v = optArg(args, flag);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function formatStatusError(payload: { status?: string; message?: string }): string {
  if (payload.status === 'no_agent') return 'no agent configured (run `leash agent create`)';
  return `${payload.status}: ${payload.message ?? '(no message)'}`;
}

/**
 * Render a `LeashToolResult` either as the raw JSON payload (when
 * `--json` is set) or via a command-specific human formatter.
 *
 * The formatter receives the parsed payload typed as `any` because
 * each command's payload shape is host-specific (defined inside the
 * `LeashHost` impl, not exposed as a runtime contract). We keep the
 * outer surface narrow by walling this off behind one helper.
 */
function printResult(
  result: LeashToolResult,
  json: boolean,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  format: (payload: any) => string,
): void {
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '{}';
  let payload: unknown = {};
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {};
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${format(payload)}\n`);
}

/** Cast a parsed-JSON payload to `any` for ergonomic field access in formatters. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asAny(p: unknown): any {
  return p as any;
}

function printHelp(): void {
  process.stdout.write(
    [
      'usage: leash <command> [options]',
      '',
      'agent commands:',
      '  agent create [--name N]            mint a sandbox agent (devnet, auto-funded)',
      '  agent show                         print active agent identity',
      '  agent export [--out PATH]          export agent.json (alias for `leash-mcp export`)',
      '  agent import <PATH>                install an agent.json',
      '',
      'treasury commands:',
      '  treasury balance                   list SOL + token balances',
      '  treasury withdraw --to W --amount N [--symbol|--mint X]',
      '                                     owner-driven on-chain withdrawal',
      '',
      'marketplace + reputation:',
      '  discover [-q QUERY] [--max-price N] [--pricing-type T] [--limit N]',
      '  reputation <agent_mint> [--network solana-devnet|solana-mainnet]',
      '',
      'activity:',
      '  receipts [--limit N] [--direction outgoing|incoming|both]',
      '  pay <link-url> [--max-spend-usdc N]',
      '',
      'misc:',
      '  doctor                             config + RPC + API reachability check',
      '  help, -h                           show this message',
      '  version, -v                        show installed version',
      '',
      'global flags:',
      '  --json                             emit the raw LeashToolResult payload',
      '',
      'config: ~/.config/leash/agent.json or LEASH_AGENT_MINT + LEASH_EXECUTIVE_KEY env vars',
      'docs:   https://leash.market/docs/cli',
      '',
    ].join('\n'),
  );
}
