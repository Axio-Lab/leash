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
 *   leash agent create              Provision an agent (two-step). First call
 *     [--name N]                    generates (or imports with `--executive
 *     [--generate | --import]       <secret>`) an executive keypair, persists
 *     [--executive <secret>]        it, and prints funding instructions. After
 *                                   you send SOL to the printed address, run
 *                                   the same command again with no args to
 *                                   finish minting + delegation + recording.
 *                                   Network comes from `LEASH_NETWORK` (or
 *                                   `agent.json:network`).
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

    case 'receipt':
      await runReceipt(argv.slice(1));
      return;

    case 'history':
      await runHistory(argv.slice(1));
      return;

    case 'daily':
      await runDaily(argv.slice(1));
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
  const name = optArg(args, '--name');
  const description = optArg(args, '--description');
  const imageUrl = optArg(args, '--image');
  const executive = optArg(args, '--executive');
  const mode: 'generate' | 'import' | undefined = executive
    ? 'import'
    : args.includes('--import')
      ? 'import'
      : args.includes('--generate')
        ? 'generate'
        : undefined;

  if (mode === 'import' && !executive) {
    process.stderr.write(
      'usage: leash agent create --import --executive <base58_secret>\n' +
        '       (or pass `--executive` alone to imply `--import`)\n',
    );
    process.exit(2);
  }

  // `--service name=https://endpoint` repeatable. EIP-8004
  // RegistrationV1 entries the agent advertises (web, api, docs, …).
  // Persisted in pending_register so Step 2 inherits them.
  let services: { name: string; endpoint: string }[] | undefined;
  try {
    services = parseServiceFlags(args);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(2);
  }

  const result = await hostRef.registerAgent({
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(services && services.length > 0 ? { services } : {}),
    ...(mode ? { mode } : {}),
    ...(executive ? { executive_secret_base58: executive } : {}),
  });
  printResult(result, json, (payload) => {
    if (payload.status === 'already_registered') {
      return `agent ${payload.agent_mint} already configured`;
    }
    if (payload.status === 'funding_required') {
      return [
        `Step 1 of 2 — fund the executive keypair, then re-run \`leash agent create\`:`,
        ``,
        `  network:        ${payload.network}`,
        `  executive:      ${payload.executive_pubkey}  (${payload.keypair_source})`,
        `  required:       ${payload.required_sol} SOL  (${payload.balance_sol} on-chain)`,
        `  config saved:   ${payload.config_path}`,
        ``,
        ...((payload.instructions as string[] | undefined) ?? []).map((line) => `  • ${line}`),
      ].join('\n');
    }
    if (payload.status === 'ok') {
      const sigs = (payload.tx_signatures ?? {}) as Record<string, string>;
      return [
        `Step 2 of 2 — agent provisioned and recorded.`,
        ``,
        `  agent mint:     ${payload.agent_mint}`,
        `  treasury:       ${payload.treasury_address}`,
        `  executive:      ${payload.executive_pubkey}`,
        `  network:        ${payload.network}`,
        `  config:         ${payload.config_written_to ?? '(not persisted)'}`,
        `  mint tx:        ${sigs.mint ?? '(unknown)'}`,
        `  delegate tx:    ${sigs.delegate ?? '(unknown)'}`,
        `  receipts:       ${payload.receipts_service_url ?? '(unknown)'}`,
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
    case 'limit':
      await runTreasuryLimit(args.slice(1));
      return;
    case 'set-limit':
      await runTreasurySetLimit(args.slice(1));
      return;
    default:
      process.stderr.write('usage: leash treasury {balance|withdraw|limit|set-limit}\n');
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

async function runTreasuryLimit(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const symbol = (optArg(args, '--token') ?? optArg(args, '--symbol') ?? 'USDC').toUpperCase() as
    | 'USDC'
    | 'USDG'
    | 'USDT';
  const result = await hostRef.getSpendLimit({ symbol });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    return [
      `spend limit (${payload.symbol})`,
      `  treasury:              ${payload.treasury}`,
      `  source ata:            ${payload.source_token_account}${payload.source_exists ? '' : '  (not yet created)'}`,
      `  delegate:              ${payload.delegate ?? '(none)'}`,
      `  executive:             ${payload.executive_pubkey}`,
      `  delegate matches:      ${payload.delegate_matches_executive ? 'yes' : 'no'}`,
      `  delegated amount:      ${payload.delegated_amount} (atomic ${payload.delegated_amount_atomic})`,
      `  treasury balance:      ${payload.balance} (atomic ${payload.balance_atomic})`,
    ].join('\n');
  });
}

async function runTreasurySetLimit(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const symbol = (optArg(args, '--token') ?? optArg(args, '--symbol') ?? 'USDC').toUpperCase() as
    | 'USDC'
    | 'USDG'
    | 'USDT';

  // Mode resolution: explicit --revoke / --unlimited / --amount win;
  // otherwise infer from `--amount <N>` presence (cap with that
  // value), else default to unlimited.
  const explicitAmount = numArg(args, '--amount');
  let mode: 'unlimited' | 'revoke' | 'amount';
  if (args.includes('--revoke')) mode = 'revoke';
  else if (args.includes('--unlimited')) mode = 'unlimited';
  else if (explicitAmount !== undefined) mode = 'amount';
  else mode = 'unlimited';

  if (mode === 'amount' && (explicitAmount === undefined || !(explicitAmount > 0))) {
    process.stderr.write(
      'usage: leash treasury set-limit [--token USDC|USDG|USDT] (--unlimited | --revoke | --amount N)\n',
    );
    process.exit(2);
  }

  const callArgs: { symbol: 'USDC' | 'USDG' | 'USDT'; mode: typeof mode; amount?: number } = {
    symbol,
    mode,
  };
  if (mode === 'amount') callArgs.amount = explicitAmount;
  const result = await hostRef.setSpendLimit(callArgs);
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    if (payload.mode === 'revoke') {
      return [
        `revoke ok (${payload.symbol})`,
        `  treasury:        ${payload.treasury}`,
        `  tx_signature:    ${payload.tx_signature}`,
        `  explorer:        ${payload.explorer_url}`,
      ].join('\n');
    }
    return [
      `set-limit ok (${payload.symbol}, ${payload.mode})`,
      `  treasury:        ${payload.treasury}`,
      `  delegate:        ${payload.delegate}`,
      `  amount:          ${payload.delegated_amount} (atomic ${payload.delegated_amount_atomic})`,
      `  tx_signature:    ${payload.tx_signature}`,
      `  explorer:        ${payload.explorer_url}`,
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

async function runReceipt(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  // Accept the hash as a positional arg (skip `--*` flags).
  const hash = args.find((a) => !a.startsWith('--'));
  if (!hash) {
    process.stderr.write(
      'usage: leash receipt <receipt_hash> [--json]\n' +
        '       (the 64-hex-char value the explorer renders at /receipt/{hash})\n',
    );
    process.exit(2);
  }
  const result = await hostRef.getReceipt({ receipt_hash: hash });
  printResult(result, json, (payload) => {
    if (payload.status === 'not_found') {
      return `not found: ${payload.receipt_hash} on ${payload.network}`;
    }
    if (payload.status !== 'ok') return formatStatusError(payload);
    const r = payload.receipt as Record<string, unknown>;
    const price = (r.price ?? {}) as Record<string, unknown>;
    const req = (r.request ?? {}) as Record<string, unknown>;
    return [
      `receipt ${payload.receipt_hash}`,
      `  agent:           ${payload.agent}`,
      `  direction:       ${payload.direction}`,
      `  decision:        ${payload.decision}`,
      `  network:         ${payload.network}`,
      `  ingested_at:     ${payload.ingested_at}`,
      `  amount:          ${price.amount ?? '?'} ${price.currency ?? ''}`,
      `  request:         ${req.method ?? '?'} ${req.url ?? '(none)'}`,
      `  tx_signature:    ${payload.tx_signature ?? '(none)'}`,
      `  explorer:        ${payload.explorer_url ?? '(none)'}`,
    ].join('\n');
  });
}

async function runHistory(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const days = numArg(args, '--days');
  const limit = numArg(args, '--limit');
  const direction = optArg(args, '--direction') as 'both' | 'outgoing' | 'incoming' | undefined;
  const result = await hostRef.transactionHistory({
    ...(days != null ? { days } : {}),
    ...(limit != null ? { limit } : {}),
    ...(direction ? { direction } : {}),
  });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    const lines = [
      `history ${payload.range.days}d  ${payload.count} receipt(s)${payload.truncated ? '  (truncated)' : ''}`,
      `  sent:     $${payload.total_sent_usd}  (${payload.sent_count})`,
      `  received: $${payload.total_received_usd}  (${payload.received_count})`,
      `  net:      $${payload.net_usd}`,
    ];
    if (payload.non_usd_count > 0) {
      lines.push(`  non-USD:  ${payload.non_usd_count} receipt(s) (excluded from totals)`);
    }
    if (payload.items?.length) {
      lines.push('');
      for (const r of payload.items) {
        lines.push(
          `  ${r.timestamp}  ${String(r.direction).padEnd(8)}  ${String(r.decision).padEnd(6)}  ${r.amount ?? '?'} ${r.currency ?? ''}  ${r.tx_signature ?? '(no tx)'}`,
        );
      }
    }
    return lines.join('\n');
  });
}

async function runDaily(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const days = numArg(args, '--days');
  const result = await hostRef.dailyTransactions({ ...(days != null ? { days } : {}) });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    const lines = [
      `daily ${payload.range.days}d (UTC)`,
      `  ${'date'.padEnd(10)}  ${'sent'.padStart(10)}  ${'recv'.padStart(10)}  ${'net'.padStart(10)}  in/out`,
    ];
    for (const b of payload.daily ?? []) {
      lines.push(
        `  ${b.date.padEnd(10)}  ${`$${b.sent_usd}`.padStart(10)}  ${`$${b.received_usd}`.padStart(10)}  ${`$${b.net_usd}`.padStart(10)}  ${b.received_count}/${b.sent_count}`,
      );
    }
    lines.push('');
    lines.push(
      `  totals: sent $${payload.totals.sent_usd}  received $${payload.totals.received_usd}  net $${payload.totals.net_usd}`,
    );
    if (payload.totals.non_usd_count > 0) {
      lines.push(`  non-USD receipts (excluded): ${payload.totals.non_usd_count}`);
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

/**
 * Parse repeatable `--service name=endpoint` flags into the
 * EIP-8004 `services[]` shape. Each occurrence must contain a single
 * `=` separating the (1-64 char) name from a valid URL endpoint.
 *
 * Examples:
 *   leash agent create --service web=https://my-agent.xyz
 *                      --service api=https://api.my-agent.xyz
 */
function parseServiceFlags(args: string[]): { name: string; endpoint: string }[] {
  const out: { name: string; endpoint: string }[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--service') continue;
    const raw = args[i + 1];
    if (!raw) {
      throw new Error('--service requires a value of the form `name=https://endpoint`');
    }
    const eq = raw.indexOf('=');
    if (eq <= 0 || eq === raw.length - 1) {
      throw new Error(
        `--service must be of the form \`name=https://endpoint\` (got: ${JSON.stringify(raw)})`,
      );
    }
    const name = raw.slice(0, eq).trim();
    const endpoint = raw.slice(eq + 1).trim();
    if (name.length === 0 || name.length > 64) {
      throw new Error(`--service name must be 1-64 chars (got: ${JSON.stringify(name)})`);
    }
    try {
      new URL(endpoint);
    } catch {
      throw new Error(`--service endpoint is not a valid URL: ${endpoint}`);
    }
    if (name === 'receipts') {
      throw new Error(
        '--service "receipts" is reserved — Leash auto-injects it. Use a different name.',
      );
    }
    out.push({ name, endpoint });
  }
  return out;
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
      '  agent create [--name N] [--description T] [--image URL]',
      '               [--service name=https://endpoint] (repeatable)',
      '               [--generate | --import --executive <secret>]',
      '                                     two-step agent provisioning. Network is taken',
      '                                     from LEASH_NETWORK (devnet|mainnet). Run once to',
      '                                     get funding instructions, fund the printed',
      '                                     pubkey with SOL, then run again to mint.',
      '                                     `--service` advertises EIP-8004 endpoints other',
      '                                     agents/humans use to find this agent (e.g.',
      '                                     `--service web=https://my-agent.xyz`).',
      '  agent show                         print active agent identity',
      '  agent export [--out PATH]          export agent.json (alias for `leash-mcp export`)',
      '  agent import <PATH>                install an agent.json',
      '',
      'treasury commands:',
      '  treasury balance                   list SOL + token balances',
      '  treasury withdraw --to W --amount N [--symbol|--mint X]',
      '                                     owner-driven on-chain withdrawal',
      '  treasury limit [--token USDC|USDG|USDT]',
      '                                     show the active SPL Approve delegation +',
      '                                     treasury balance for a stable',
      '  treasury set-limit [--token USDC|USDG|USDT]',
      '                    (--unlimited | --revoke | --amount N)',
      "                                     update the executive's SPL spend authority.",
      '                                     `--unlimited` (default) writes u64::MAX,',
      '                                     `--revoke` zeros it, `--amount N` caps at N',
      '                                     human units (e.g. --amount 100 = $100 USDC).',
      '',
      'marketplace + reputation:',
      '  discover [-q QUERY] [--max-price N] [--pricing-type T] [--limit N]',
      '  reputation <agent_mint> [--network solana-devnet|solana-mainnet]',
      '',
      'activity:',
      '  receipts [--limit N] [--direction outgoing|incoming|both]',
      '                                     paginated receipt feed for the active agent',
      '  receipt <receipt_hash>             fetch a single ReceiptV1 by its hash',
      '                                     (the same hash the explorer renders at /receipt/{hash})',
      '  history [--days N] [--limit N] [--direction outgoing|incoming|both]',
      '                                     receipts in the last N days (default 7) plus',
      '                                     running totals: sent/received/net in USD',
      '  daily [--days N]                   per-day P&L buckets for the last N days',
      '                                     (default 7); stables summed at 1:1 USD',
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
