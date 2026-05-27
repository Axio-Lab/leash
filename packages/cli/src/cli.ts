#!/usr/bin/env node
/**
 * `leash` — human-driven Leash CLI.
 *
 * Wraps the same `LeashHost` that `@leashmarket/mcp` exposes to AI agents,
 * but skips the MCP wire protocol and renders results as plain text
 * (or `--json` when machine-readable output is wanted). Designed to
 * be the "git/gh/aws" of the Leash identity layer: a small, fast tool
 * for humans who want to inspect, verify, or operate their agent without
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
 *   leash api-key create --label N  Create an agent-scoped API key via X-Leash-Sig.
 *   leash api-key list              List agent-scoped API keys.
 *   leash api-key revoke <id>       Revoke an agent-scoped API key.
 *   leash treasury balance          List SOL + USDC/USDG/USDT balances.
 *   leash treasury withdraw …       Owner-driven on-chain withdrawal.
 *   leash discover [-q QUERY] …     Search Leash + pay-skills (public).
 *   leash discover endpoints <fqn>  Expand a pay-skills provider into paid URLs.
 *   leash identity resolve …        Resolve a mint / handle / verified domain.
 *   leash identity verify …         Verify a mint / handle / verified domain
 *                                   or request a full allow/warn/deny trust verdict.
 *   leash reputation <agent_mint>   Reputation snapshot (public).
 *   leash receipts [--limit N]      Recent receipts for the active agent.
 *   leash pay <link-url> [--method …]   Pay an x402 or MPP paywall (auto-detected).
 *   leash sell create-link …            Create a hosted link or monetize an endpoint (--protocol x402|mpp).
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

import { HostRef, buildServerFromEnv } from '@leashmarket/mcp';
import type { LeashHost, LeashToolResult } from '@leashmarket/mcp-core';

const VERSION = '0.2.6';

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

    case 'api-key':
    case 'api-keys':
      await runApiKey(argv.slice(1));
      return;

    case 'treasury':
      await runTreasury(argv.slice(1));
      return;

    case 'discover':
      await runDiscover(argv.slice(1));
      return;

    case 'identity':
      await runIdentity(argv.slice(1));
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

    case 'sell':
      await runSell(argv.slice(1));
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
// api-key
// ────────────────────────────────────────────────────────────────────────────

async function runApiKey(args: string[]): Promise<void> {
  const sub = args[0];
  switch (sub) {
    case 'create':
      await runApiKeyCreate(args.slice(1));
      return;
    case 'list':
      await runApiKeyList(args.slice(1));
      return;
    case 'revoke':
    case 'disable':
      await runApiKeyRevoke(args.slice(1));
      return;
    default:
      process.stderr.write(
        'usage: leash api-key {create|list|revoke}\n' +
          '       leash api-key create --label <name> [--network solana-devnet|solana-mainnet] [--json]\n' +
          '       leash api-key list [--include-disabled] [--limit N] [--json]\n' +
          '       leash api-key revoke <id> [--json]\n',
      );
      process.exit(2);
  }
}

async function runApiKeyCreate(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const label = optArg(args, '--label') ?? optArg(args, '-l');
  const network = optArg(args, '--network') as
    | 'solana-devnet'
    | 'solana-mainnet'
    | 'devnet'
    | 'mainnet'
    | undefined;
  if (!label) {
    process.stderr.write(
      'usage: leash api-key create --label <name> [--network solana-devnet|solana-mainnet] [--json]\n',
    );
    process.exit(2);
  }
  if (network) {
    const normalized =
      network === 'devnet' ? 'solana-devnet' : network === 'mainnet' ? 'solana-mainnet' : network;
    if (normalized !== hostRef.network) {
      process.stderr.write(
        `configured agent is on ${hostRef.network}; cannot create a ${normalized} key for this agent\n`,
      );
      process.exit(2);
    }
  }

  const result = await hostRef.createAgentApiKey({ label });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    return [
      `agent API key created`,
      `  id:           ${payload.key.id}`,
      `  label:        ${payload.key.label}`,
      `  network:      ${payload.key.network}`,
      `  owner_wallet: ${payload.key.owner_wallet}`,
      `  agent_mint:   ${payload.key.agent_mint}`,
      `  scope:        ${payload.key.scopes?.join(',') ?? 'agent'}`,
      `  plaintext:    ${payload.plaintext}`,
      ``,
      `Store plaintext now. It is returned only once.`,
    ].join('\n');
  });
}

async function runApiKeyList(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const limit = numArg(args, '--limit');
  const result = await hostRef.listAgentApiKeys({
    ...(args.includes('--include-disabled') ? { include_disabled: true } : {}),
    ...(limit !== undefined ? { limit } : {}),
  });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    if (!payload.items?.length) return 'no agent API keys found';
    const lines = [`${payload.count} agent API key(s):`];
    for (const key of payload.items) {
      lines.push(
        `  ${key.id}  ${key.label}  ${key.prefix}…${key.last4}  ${key.network}  ${key.disabled_at ? 'disabled' : 'active'}`,
      );
    }
    return lines.join('\n');
  });
}

async function runApiKeyRevoke(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const id = args.find((a) => !a.startsWith('-'));
  if (!id) {
    process.stderr.write('usage: leash api-key revoke <id> [--json]\n');
    process.exit(2);
  }
  const result = await hostRef.revokeAgentApiKey({ id });
  printResult(result, json, (payload) => {
    if (payload.status !== 'revoked') return formatStatusError(payload);
    return [
      `agent API key revoked`,
      `  id:        ${payload.key.id}`,
      `  label:     ${payload.key.label}`,
      `  disabled:  ${payload.key.disabled_at ?? 'yes'}`,
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
  // Sub-commands. Today: `discover endpoints <fqn>` mirrors
  // `pay skills endpoints <fqn>` from the pay.sh CLI — handy for
  // expanding a chosen pay-skills provider into its paid URLs once
  // search has narrowed the field.
  if (args[0] === 'endpoints') {
    await runDiscoverEndpoints(args.slice(1));
    return;
  }

  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const rawSource = optArg(args, '--source');
  const source =
    rawSource === 'leash' || rawSource === 'pay-skills' || rawSource === 'all'
      ? rawSource
      : undefined;
  const query = {
    capability: optArg(args, '-q') ?? optArg(args, '--capability'),
    max_price_usdc: numArg(args, '--max-price'),
    pricing_type: optArg(args, '--pricing-type') as 'free' | 'per_call' | 'variable' | undefined,
    source,
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
      const tag = item.source === 'pay-skills' ? '[pay.sh]' : '[leash] ';
      const slug = item.source === 'pay-skills' ? `  (fqn: ${item.slug})` : '';
      lines.push(`  ${tag} ${item.title} — ${price} — ${item.url}${slug}`);
      if (item.seller_identity) {
        const identity = item.seller_identity as {
          handle?: string | null;
          mint?: string;
          name?: string;
        };
        const label = identity.handle ? `@${identity.handle}` : (identity.name ?? identity.mint);
        lines.push(`           seller identity: ${label} (${identity.mint})`);
      } else if (item.source === 'leash') {
        lines.push('           seller identity: unverified legacy listing');
      } else {
        lines.push('           seller identity: external pay.sh provider');
      }
      lines.push(`           ${item.description}`);
    }
    if ((payload.items ?? []).some((i: { source?: string }) => i.source === 'pay-skills')) {
      lines.push('');
      lines.push('Tip: `leash discover endpoints <fqn>` to expand a pay.sh provider.');
    }
    return lines.join('\n');
  });
}

async function runDiscoverEndpoints(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const fqn = args.find((a) => !a.startsWith('--'));
  if (!fqn) {
    process.stderr.write(
      'usage: leash discover endpoints <fqn>\n' +
        '\n' +
        '  <fqn>   pay-skills FQN like `agentmail/email` or\n' +
        '          `coinbase-cdp/coinbase-developer-platform/baseSepoliaWalletApi`.\n' +
        '          Lift it from the `(fqn: ...)` hint emitted by `leash discover`.\n',
    );
    process.exit(2);
  }
  const result = await hostRef.paySkillsProvider({ fqn });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    const lines = [
      `${payload.title} — ${payload.fqn}`,
      `  service_url: ${payload.service_url}`,
      `  category:    ${payload.category}`,
      `  endpoints:   ${payload.endpoints.length}`,
      '',
    ];
    for (const ep of payload.endpoints ?? []) {
      const protocols = (ep.protocol ?? []).join(',') || '(none)';
      const stables = (ep.supported_usd ?? []).join(',') || '(none)';
      const probe = ep.probe_status ?? '?';
      const priceTier = ep.pricing?.dimensions?.[0]?.tiers?.[0]?.price_usd;
      const price = typeof priceTier === 'number' ? `${priceTier} USD` : 'variable';
      lines.push(
        `  ${ep.method.padEnd(6)} ${ep.url}` +
          `\n           ${ep.description ?? '(no description)'}`,
      );
      lines.push(
        `           price=${price}  protocol=${protocols}  stables=${stables}  probe=${probe}`,
      );
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

async function runIdentity(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub !== 'resolve' && sub !== 'verify') {
    process.stderr.write(
      'usage: leash identity {resolve|verify} (--mint M | --handle H | --domain D) [--json]\n',
    );
    process.exit(2);
  }
  const selector = identitySelector(args.slice(1));
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const result =
    sub === 'resolve'
      ? await hostRef.resolveIdentity(selector)
      : await hostRef.verifyIdentity(identityVerifyArgs(args.slice(1), selector));
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    if (sub === 'verify') {
      if (typeof payload.verdict === 'string') {
        const checks = (payload.checks ?? []) as Array<{
          name: string;
          passed: boolean;
          severity: string;
          detail: string;
        }>;
        const profile = payload.profile as
          | {
              handle?: string | null;
              name?: string;
              capability_cards_count?: number;
              claims_count?: number;
              reputation?: { rating?: number; settled_calls?: number };
            }
          | null
          | undefined;
        return [
          `verdict: ${payload.verdict}`,
          `score: ${payload.score}`,
          `resolved_mint: ${payload.resolved_mint ?? '(none)'}`,
          `network: ${payload.network ?? '(none)'}`,
          profile
            ? `profile: ${profile.handle ? `@${profile.handle}` : (profile.name ?? '(unnamed)')} · capabilities=${profile.capability_cards_count ?? 0} · claims=${profile.claims_count ?? 0} · rating=${Number(profile.reputation?.rating ?? 0).toFixed(4)}`
            : 'profile: (none)',
          ...checks.map(
            (c) => `  ${c.passed ? 'ok' : 'fail'} ${c.name} [${c.severity}]: ${c.detail}`,
          ),
        ].join('\n');
      }
      const checks = (payload.checks ?? []) as Array<{
        name: string;
        passed: boolean;
        detail: string;
      }>;
      return [
        `verified: ${payload.verified ? 'yes' : 'no'}`,
        `resolved_mint: ${payload.resolved_mint ?? '(none)'}`,
        `network: ${payload.network ?? '(none)'}`,
        ...checks.map((c) => `  ${c.passed ? 'ok' : 'fail'} ${c.name}: ${c.detail}`),
      ].join('\n');
    }
    return [
      `${payload.name ?? 'Agent'} (${payload.network})`,
      `  mint:       ${payload.mint}`,
      `  handle:     ${payload.handle ? `@${payload.handle}` : '(none)'}`,
      `  treasury:   ${payload.treasury}`,
      `  domains:    ${((payload.verified_domains as string[] | undefined) ?? []).join(', ') || '(none)'}`,
      `  capability_cards: ${((payload.capability_cards as unknown[] | undefined) ?? []).length}`,
      `  claims:           ${((payload.claims as unknown[] | undefined) ?? []).length}`,
      `  reputation:       ${Number((payload.reputation as { rating?: number } | undefined)?.rating ?? 0).toFixed(4)}`,
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
    process.stderr.write(
      'usage: leash pay <link-url> [--method GET|POST] [--body <json>] [--json]\n' +
        '       x402 and MPP links are auto-detected after probing the paywall.\n',
    );
    process.exit(2);
  }
  const methodRaw = (optArg(args, '--method') ?? 'GET').toUpperCase();
  if (methodRaw !== 'GET' && methodRaw !== 'POST') {
    process.stderr.write('--method must be GET or POST\n');
    process.exit(2);
  }
  const body = optArg(args, '--body');
  const result = await hostRef.pay({
    url,
    method: methodRaw as 'GET' | 'POST',
    ...(body ? { body } : {}),
  });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    const amt = payload.paid_amount_atomic ?? payload.amount;
    const cur = payload.currency ?? '';
    const summary = amt != null && cur ? `settled ${amt} ${cur} (atomic units)` : 'settled';
    return [
      summary,
      `  tx_signature:    ${payload.tx_signature}`,
      `  receipt_hash:    ${payload.receipt_hash}`,
      `  explorer:        ${payload.explorer_url}`,
    ].join('\n');
  });
}

async function runSell(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub === 'create-link') {
    await runSellCreateLink(args.slice(1));
    return;
  }
  process.stderr.write(
    'usage: leash sell create-link --label <text> --amount <n> [--currency USDC|USDG|USDT] [--description <text>] [--method GET|POST] [--upstream-url <url>] [--expected-body <json-object>] [--protocol x402|mpp] [--json]\n' +
      '\n' +
      'Creates a hosted payment link via the Leash API (requires LEASH_API_KEY).\n' +
      'Pass --upstream-url to monetize an existing API endpoint; paid calls forward there after settlement.\n' +
      "Pass --expected-body '{}' to describe the JSON body buyers should send to POST links.\n" +
      'Use --protocol mpp for MPP (`problem+json`) paywalls instead of default x402.\n',
  );
  process.exit(2);
}

async function runSellCreateLink(args: string[]): Promise<void> {
  const { hostRef } = buildServerFromEnv();
  const json = wantJson(args);
  const label = optArg(args, '--label');
  const amount = numArg(args, '--amount');
  const currency = (optArg(args, '--currency') ?? 'USDC').toUpperCase() as 'USDC' | 'USDG' | 'USDT';
  const description = optArg(args, '--description');
  const upstreamUrl = optArg(args, '--upstream-url');
  const expectedBodyRaw = optArg(args, '--expected-body');
  const methodRaw = (optArg(args, '--method') ?? 'GET').toUpperCase();
  const protoRaw = optArg(args, '--protocol')?.toLowerCase();
  const protocol =
    protoRaw === 'mpp' ? ('mpp' as const) : protoRaw === 'x402' ? ('x402' as const) : undefined;

  if (!label || amount == null || !(amount > 0)) {
    process.stderr.write(
      'usage: leash sell create-link --label <text> --amount <positive number> [--currency USDC|USDG|USDT] [--description <text>] [--method GET|POST] [--upstream-url <url>] [--expected-body <json-object>] [--protocol x402|mpp]\n',
    );
    process.exit(2);
  }
  if (!['USDC', 'USDG', 'USDT'].includes(currency)) {
    process.stderr.write(`unsupported --currency ${currency} (use USDC, USDG, or USDT)\n`);
    process.exit(2);
  }
  if (protoRaw && protoRaw !== 'mpp' && protoRaw !== 'x402') {
    process.stderr.write('--protocol must be x402 or mpp\n');
    process.exit(2);
  }
  if (methodRaw !== 'GET' && methodRaw !== 'POST') {
    process.stderr.write('--method must be GET or POST\n');
    process.exit(2);
  }
  if (upstreamUrl) {
    try {
      const url = new URL(upstreamUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
    } catch {
      process.stderr.write('--upstream-url must be a valid http(s) URL\n');
      process.exit(2);
    }
  }
  let expectedRequestBody: Record<string, unknown> | undefined;
  if (expectedBodyRaw !== undefined) {
    try {
      const parsed = JSON.parse(expectedBodyRaw) as unknown;
      if (!isPlainObject(parsed)) throw new Error('not an object');
      expectedRequestBody = parsed;
    } catch {
      process.stderr.write("--expected-body must be a valid JSON object, for example '{}'\n");
      process.exit(2);
    }
  }

  const result = await hostRef.createPaymentLink({
    label,
    amount,
    currency,
    ...(description ? { description } : {}),
    method: methodRaw as 'GET' | 'POST',
    ...(upstreamUrl ? { upstream_url: upstreamUrl } : {}),
    ...(expectedRequestBody !== undefined ? { expected_request_body: expectedRequestBody } : {}),
    ...(protocol ? { protocol } : {}),
  });
  printResult(result, json, (payload) => {
    if (payload.status !== 'ok') return formatStatusError(payload);
    const proto = (payload.protocol as string | undefined) ?? 'x402';
    return [
      `payment link created (${proto})`,
      `  id:          ${payload.id}`,
      `  url:         ${payload.url}`,
      `  price:       ${payload.price}`,
      `  method:      ${payload.method ?? methodRaw}`,
      ...(payload.upstream_url ? [`  upstream:   ${payload.upstream_url}`] : []),
      ...(payload.expected_request_body ? ['  expected:   request body metadata set'] : []),
      `  network:     ${payload.network}`,
      `  owner_agent: ${payload.owner_agent}`,
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

function allOptArgs(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) out.push(args[i + 1]!);
  }
  return out;
}

function numArg(args: string[], flag: string): number | undefined {
  const v = optArg(args, flag);
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
      'api key commands:',
      '  api-key create --label NAME [--network solana-devnet|solana-mainnet]',
      '                                     create an agent-scoped API key by signing',
      "                                     with the configured agent's executive key.",
      '                                     Plaintext is printed once; store it securely.',
      '  api-key list [--include-disabled] [--limit N]',
      '                                     list this agent’s API keys (no plaintext)',
      '  api-key revoke <id>                disable one of this agent’s API keys',
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
      '  discover [-q QUERY] [--max-price N] [--pricing-type T] [--source leash|pay-skills|all] [--limit N]',
      '    Searches the Leash marketplace + Solana Foundation pay-skills registry (merged).',
      '  discover endpoints <fqn>           expand a pay-skills provider into its paid endpoint',
      '                                     URLs (mirrors `pay skills endpoints <fqn>`). Take the',
      '                                     <fqn> from the `(fqn: ...)` hint of `leash discover`.',
      '  identity resolve (--mint M | --handle H | --domain D)',
      '                                     resolve an agent identity profile',
      '  identity verify (--mint M | --handle H | --domain D)',
      '                  [--intent pay|call_capability|trust_claim|inspect]',
      '                  [--capability-kind K] [--capability-slug S]',
      '                  [--endpoint URL] [--protocol x402|mpp]',
      '                  [--min-rating N] [--require-claim T] [--require-domain]',
      '                                     verify an identity or request a trust verdict',
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
      '  pay <link-url> [--method GET|POST] [--body <json>]',
      '                                     settle a payment via buyer-kit (local exec key).',
      '                                     x402 + MPP links are probed automatically; use POST',
      '                                     when the seller endpoint requires it.',
      '  sell create-link --label L --amount N [--currency C] [--description …]',
      '                    [--method GET|POST] [--upstream-url URL]',
      '                    [--expected-body JSON] [--protocol x402|mpp]',
      '                                     create a hosted payment link (needs LEASH_API_KEY).',
      '                                     Pass --upstream-url to monetize an existing API endpoint.',
      "                                     Pass --expected-body '{}' to describe POST body metadata.",
      '                                     Default protocol is x402; use mpp for MPP paywalls.',
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

function identitySelector(args: string[]): { mint?: string; handle?: string; domain?: string } {
  const mint = optArg(args, '--mint');
  const handle = optArg(args, '--handle');
  const domain = optArg(args, '--domain');
  const count = [mint, handle, domain].filter(Boolean).length;
  if (count !== 1) {
    process.stderr.write(
      'usage: leash identity {resolve|verify} (--mint M | --handle H | --domain D) [--json]\n',
    );
    process.exit(2);
  }
  return {
    ...(mint ? { mint } : {}),
    ...(handle ? { handle } : {}),
    ...(domain ? { domain } : {}),
  };
}

function identityVerifyArgs(
  args: string[],
  selector: { mint?: string; handle?: string; domain?: string },
): Parameters<LeashHost['verifyIdentity']>[0] {
  const intent = optArg(args, '--intent') as
    | 'pay'
    | 'call_capability'
    | 'trust_claim'
    | 'inspect'
    | undefined;
  const kind = optArg(args, '--capability-kind');
  const slug = optArg(args, '--capability-slug') ?? optArg(args, '--capability');
  const endpoint = optArg(args, '--endpoint');
  const protocol = optArg(args, '--protocol') as 'x402' | 'mpp' | undefined;
  const minRating = numArg(args, '--min-rating');
  const requiredClaims = allOptArgs(args, '--require-claim');
  const requireDomain = args.includes('--require-domain');
  const wantsDecision =
    intent ||
    kind ||
    slug ||
    endpoint ||
    protocol ||
    minRating !== undefined ||
    requiredClaims.length > 0 ||
    requireDomain;
  if (!wantsDecision) return selector;
  if (intent && !['pay', 'call_capability', 'trust_claim', 'inspect'].includes(intent)) {
    process.stderr.write('--intent must be pay, call_capability, trust_claim, or inspect\n');
    process.exit(2);
  }
  if (protocol && protocol !== 'x402' && protocol !== 'mpp') {
    process.stderr.write('--protocol must be x402 or mpp\n');
    process.exit(2);
  }
  return {
    selector,
    intent: intent ?? 'inspect',
    ...(kind || slug || endpoint || protocol
      ? {
          capability: {
            ...(kind ? { kind } : {}),
            ...(slug ? { slug } : {}),
            ...(endpoint ? { endpoint } : {}),
            ...(protocol ? { protocol } : {}),
          },
        }
      : {}),
    ...(minRating !== undefined || requiredClaims.length > 0 || requireDomain
      ? {
          thresholds: {
            ...(minRating !== undefined ? { min_rating: minRating } : {}),
            ...(requiredClaims.length > 0 ? { required_claim_types: requiredClaims } : {}),
            ...(requireDomain ? { require_verified_domain: true } : {}),
          },
        }
      : {}),
  };
}
