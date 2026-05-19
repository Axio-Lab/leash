/**
 * Real-devnet integration test for the standalone `@leashmarket/mcp` server.
 *
 * What this proves end-to-end through the MCP wire protocol
 * --------------------------------------------------------
 * The same path the LLM walks during the YC demo, executed without an
 * LLM in the loop. Every assertion is on-chain or via the MCP client.
 *
 *   1. boot the MCP server with NO agent configured (`hostRef.agentMint
 *      === null`)
 *   2. `tools/list` returns the seven canonical tools in stable order
 *   3. `leash_check_treasury_balance` short-circuits with `no_agent` —
 *      proves the placeholder host is wired
 *   4. `leash_register_agent` hits the live `POST /v1/sandbox/agent`
 *      endpoint, mints + funds an agent on devnet, persists
 *      `~/.config/leash/agent.json` (in a temp dir), and HOT-SWAPS the
 *      in-memory MCP host
 *   5. `leash_get_identity` reports the new mint without a server
 *      restart — proves the swap took
 *   6. `leash_check_treasury_balance` shows the auto-funded $1 USDC +
 *      0.01 SOL via a real RPC read against the treasury PDA
 *   7. `leash_withdraw_treasury` of $0.10 USDC to a fresh wallet
 *      actually settles on chain (the MCP signs locally with the
 *      executive keypair, the receipt has a real tx_signature)
 *   8. the RPC confirms the destination ATA now holds $0.10 USDC
 *
 * What's NOT tested here (and why)
 * --------------------------------
 * `leash_pay_payment_link` — needs a live x402 seller URL. We could
 * spin one up via `apps/api`'s payment-link endpoints, but that
 * requires a service API key and adds setup the YC video itself
 * doesn't need (the recording uses a real third-party seller). The
 * pay path is exercised by `apps/agents` chat-product tests + the
 * batch 11 demo recording prep.
 *
 * Required env
 * ------------
 *   LEASH_E2E_API_URL    base URL (default: http://localhost:8801)
 *   LEASH_E2E_RPC        devnet RPC (default: api.devnet.solana.com)
 *
 * Bring the api up first:
 *   pnpm --filter @leashmarket/api dev
 *
 * Then:
 *   pnpm --filter @leashmarket/mcp test:yc-demo-devnet
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { generateSigner, publicKey } from '@metaplex-foundation/umi';
import { mplToolbox, findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { mplCore } from '@metaplex-foundation/mpl-core';

import { buildServerFromEnv } from '../src/server.js';

const API_URL = (process.env.LEASH_E2E_API_URL ?? 'http://localhost:8801').replace(/\/+$/, '');
const RPC = process.env.LEASH_E2E_RPC ?? 'https://api.devnet.solana.com';
const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const log = {
  step: (n: number, title: string) => console.log(`\n──── ${n}. ${title} ────`),
  ok: (msg: string) => console.log(`  ✓ ${msg}`),
  info: (msg: string) => console.log(`  · ${msg}`),
  fatal: (msg: string): never => {
    console.error(`\n✗ ${msg}`);
    process.exit(1);
  },
};

type ToolResult = { content: Array<{ type: string; text: string }> };

function parseToolPayload<T>(result: ToolResult, toolName: string): T {
  const txt = result.content?.[0]?.text;
  if (!txt) log.fatal(`${toolName}: empty content`);
  try {
    return JSON.parse(txt) as T;
  } catch (e) {
    return log.fatal(
      `${toolName}: response is not JSON (${e instanceof Error ? e.message : 'unknown'}): ${txt.slice(0, 200)}`,
    );
  }
}

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('Leash batch-5 YC-demo-flow integration test (devnet, MCP)');
  console.log('============================================================');
  console.log(`api : ${API_URL}`);
  console.log(`rpc : ${RPC}`);

  // Use a private temp dir so the test never touches the developer's
  // real ~/.config/leash/agent.json. registerAgent will write into it.
  const tempDir = mkdtempSync(join(tmpdir(), 'leash-yc-demo-'));
  const configPath = join(tempDir, 'agent.json');
  // Force a fresh-host boot regardless of the developer's environment.
  const ENV_KEYS = [
    'LEASH_AGENT_MINT',
    'LEASH_EXECUTIVE_KEY',
    'LEASH_NETWORK',
    'LEASH_API_URL',
    'LEASH_RPC_URL',
    'LEASH_API_KEY',
    'LEASH_PER_CALL_USDC',
    'LEASH_PER_DAY_USDC',
  ];
  const envSnap: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) {
    envSnap[k] = process.env[k];
    delete process.env[k];
  }
  // Point the host at our local API.
  process.env.LEASH_API_URL = API_URL;
  process.env.LEASH_RPC_URL = RPC;

  let stepNum = 0;
  const step = (title: string) => log.step(++stepNum, title);

  try {
    // ── 1. boot ─────────────────────────────────────────────────────
    step('boot MCP server with no agent');
    const { server, hostRef, config } = buildServerFromEnv({ configPath });
    if (config !== null) log.fatal(`expected null config, got ${JSON.stringify(config)}`);
    if (hostRef.agentMint !== null) log.fatal(`expected agentMint=null, got ${hostRef.agentMint}`);
    log.ok(`hostRef.agentMint   : null`);
    log.ok(`hostRef.network     : ${hostRef.network}`);
    log.ok(`hostRef.apiBaseUrl  : ${hostRef.apiBaseUrl}`);

    const [serverT, clientT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'leash-yc-demo', version: '0.0.1' }, { capabilities: {} });
    await Promise.all([server.connect(serverT), client.connect(clientT)]);

    // ── 2. tools/list ───────────────────────────────────────────────
    step('tools/list returns 17 canonical tools');
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    const expected = [
      'leash_check_treasury_balance',
      'leash_create_payment_link',
      'leash_daily_transactions',
      'leash_discover',
      'leash_get_identity',
      'leash_get_receipt',
      'leash_get_spend_limit',
      'leash_pay_payment_link',
      'leash_pay_skills_endpoints',
      'leash_receipts',
      'leash_register_agent',
      'leash_reputation',
      'leash_resolve_identity',
      'leash_set_spend_limit',
      'leash_transaction_history',
      'leash_verify_identity',
      'leash_withdraw_treasury',
    ];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      log.fatal(
        `tool names mismatch:\n  expected: ${expected.join(', ')}\n  actual:   ${names.join(', ')}`,
      );
    }
    log.ok(`tools (${expected.length}): ${names.join(', ')}`);

    // ── 3. no-agent short-circuit ───────────────────────────────────
    step('leash_check_treasury_balance short-circuits with no_agent');
    const noAgentBal = parseToolPayload<{ kind: string; status: string }>(
      (await client.callTool({
        name: 'leash_check_treasury_balance',
        arguments: {},
      })) as ToolResult,
      'leash_check_treasury_balance',
    );
    if (noAgentBal.status !== 'no_agent') {
      log.fatal(`expected status=no_agent, got ${noAgentBal.status}`);
    }
    log.ok('placeholder host correctly returns no_agent');

    // ── 4. leash_register_agent ─────────────────────────────────────
    step('leash_register_agent → POST /v1/sandbox/agent → hot-swap');
    const reg = parseToolPayload<{
      kind: string;
      status: string;
      agent_mint: string;
      treasury_address: string;
      executive_pubkey: string;
      network: string;
      funded_with: { sol_lamports: string; usdc_atomic: string };
      tx_signatures: { sol_drip: string; mint: string; usdc_drip: string };
      explorer_url: string;
      config_written_to: string;
      message?: string;
    }>(
      (await client.callTool({
        name: 'leash_register_agent',
        arguments: { name: 'yc-demo-bot' },
      })) as ToolResult,
      'leash_register_agent',
    );
    if (reg.status !== 'ok') {
      log.fatal(`register_agent failed: ${JSON.stringify(reg, null, 2)}`);
    }
    log.ok(`agent_mint        : ${reg.agent_mint}`);
    log.ok(`treasury_address  : ${reg.treasury_address}`);
    log.ok(`executive_pubkey  : ${reg.executive_pubkey}`);
    log.ok(`network           : ${reg.network}`);
    log.ok(
      `funded_with.usdc  : ${reg.funded_with.usdc_atomic} atomic ($${Number(reg.funded_with.usdc_atomic) / 1e6})`,
    );
    log.ok(
      `funded_with.sol   : ${reg.funded_with.sol_lamports} lamports (${Number(reg.funded_with.sol_lamports) / 1e9} SOL)`,
    );
    log.ok(`mint tx           : ${reg.tx_signatures.mint}`);
    log.ok(`config persisted  : ${reg.config_written_to}`);

    // ── 5. leash_get_identity ───────────────────────────────────────
    step('leash_get_identity reports the new mint (in-memory swap took)');
    const id = parseToolPayload<{
      kind: string;
      status: string;
      agent_mint: string;
      treasury_address: string;
      executive_pubkey: string;
      network: string;
    }>(
      (await client.callTool({
        name: 'leash_get_identity',
        arguments: {},
      })) as ToolResult,
      'leash_get_identity',
    );
    if (id.status !== 'ok') log.fatal(`get_identity status=${id.status}`);
    if (id.agent_mint !== reg.agent_mint) {
      log.fatal(`identity mint mismatch: ${id.agent_mint} vs ${reg.agent_mint}`);
    }
    if (id.executive_pubkey !== reg.executive_pubkey) {
      log.fatal(`identity executive mismatch`);
    }
    log.ok(`identity matches register_agent output exactly`);

    // ── 6. leash_check_treasury_balance ─────────────────────────────
    step('leash_check_treasury_balance reads live treasury via RPC');
    // Devnet RPCs sometimes lag a few seconds after the sandbox call.
    let bal: {
      kind: string;
      status: string;
      sol: number;
      tokens: Array<{ symbol: string; ui: number; amount: string }>;
    } | null = null;
    for (let i = 0; i < 6; i += 1) {
      bal = parseToolPayload(
        (await client.callTool({
          name: 'leash_check_treasury_balance',
          arguments: {},
        })) as ToolResult,
        'leash_check_treasury_balance',
      );
      if (
        bal &&
        bal.status === 'ok' &&
        bal.tokens.some((t) => (t.symbol ?? '').toLowerCase() === 'usdc')
      ) {
        break;
      }
      await sleep(1500);
    }
    if (!bal || bal.status !== 'ok') log.fatal(`check_treasury_balance: ${JSON.stringify(bal)}`);
    const balOk = bal!;
    const usdc = balOk.tokens.find((t) => (t.symbol ?? '').toLowerCase() === 'usdc');
    if (!usdc) {
      log.fatal(`no USDC in treasury (got: ${balOk.tokens.map((t) => t.symbol).join(', ')})`);
    }
    const usdcOk = usdc!;
    if (usdcOk.ui < 1) log.fatal(`expected USDC ≥ 1.0, got ${usdcOk.ui}`);
    log.ok(`treasury USDC : ${usdcOk.ui}  (atomic ${usdcOk.amount})`);
    log.ok(`treasury SOL  : ${balOk.sol}`);

    // ── 7. leash_withdraw_treasury ──────────────────────────────────
    step('leash_withdraw_treasury 0.10 USDC to fresh wallet');
    const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
    const dest = generateSigner(umi).publicKey.toString();
    log.info(`destination wallet : ${dest}`);

    const wd = parseToolPayload<{
      kind: string;
      status: string;
      tx_signature: string;
      destination: string;
      amount: string;
      amount_atomic: string;
      explorer_url: string;
      message?: string;
    }>(
      (await client.callTool({
        name: 'leash_withdraw_treasury',
        arguments: { token: 'USDC', amount: 0.1, destination: dest },
      })) as ToolResult,
      'leash_withdraw_treasury',
    );
    if (wd.status !== 'ok') log.fatal(`withdraw failed: ${JSON.stringify(wd, null, 2)}`);
    log.ok(`tx_signature  : ${wd.tx_signature}`);
    log.ok(`amount_atomic : ${wd.amount_atomic}`);
    log.ok(`explorer_url  : ${wd.explorer_url}`);

    // ── 8. RPC verify ──────────────────────────────────────────────
    step('RPC confirms destination ATA holds 0.10 USDC');
    // Wait briefly for the destination ATA to appear and be readable.
    let destAtaAmount: bigint = 0n;
    for (let i = 0; i < 10; i += 1) {
      const [ata] = findAssociatedTokenPda(umi, {
        mint: publicKey(USDC_DEVNET),
        owner: publicKey(dest),
      });
      const acct = await umi.rpc.getAccount(ata);
      if (acct.exists && acct.data.length >= 72) {
        let amt = 0n;
        for (let j = 0; j < 8; j += 1) {
          amt |= BigInt(acct.data[64 + j]!) << BigInt(8 * j);
        }
        destAtaAmount = amt;
        if (amt > 0n) break;
      }
      await sleep(1500);
    }
    if (destAtaAmount !== 100_000n) {
      log.fatal(
        `expected 100_000 atomic USDC at destination ATA, got ${destAtaAmount} after waiting`,
      );
    }
    log.ok(`destination ATA balance : ${destAtaAmount} atomic ($${Number(destAtaAmount) / 1e6})`);

    await client.close();
    await server.close();

    console.log('\n============================================================');
    console.log('All YC-demo flow steps passed end-to-end on devnet.');
    console.log('============================================================\n');
    console.log(`agent_mint        : ${reg.agent_mint}`);
    console.log(`executive_pubkey  : ${reg.executive_pubkey}`);
    console.log(`mint tx           : ${reg.tx_signatures.mint}`);
    console.log(`withdraw tx       : ${wd.tx_signature}`);
    console.log(`solscan agent     : https://solscan.io/account/${reg.agent_mint}?cluster=devnet`);
    console.log(`solscan withdraw  : ${wd.explorer_url}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    for (const k of ENV_KEYS) {
      if (envSnap[k] === undefined) delete process.env[k];
      else process.env[k] = envSnap[k];
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
