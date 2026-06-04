/**
 * Devnet E2E: create plan → subscribe → collect → cancel → resume/reactivate → revoke guard.
 *
 * This exercises the treasury-funded agent path: the executive wallet signs,
 * while the native subscription debits the agent treasury PDA ATA. A fresh
 * cancellation cannot be revoked until the native program's cancel grace
 * expires, so the final step proves the revoke guard unless an old/expired
 * subscription is supplied through a custom script.
 *
 * Defaults:
 *   - keypair/config: ~/.config/leash/agent.json
 *   - agent mint: agent_mint from that config
 *   - mint: Circle devnet USDC
 *   - amount: 0.01 USDC
 *
 * Useful overrides:
 *   LEASH_TEST_AGENT_MINT
 *   LEASH_TEST_PAYER_SECRET_KEY_FILE
 *   LEASH_TEST_PAYER_SECRET_KEY
 *   LEASH_TEST_RPC
 *   LEASH_TEST_USDC_MINT
 *   LEASH_TEST_PLAN_USDC
 *   LEASH_TEST_PLAN_PERIOD_HOURS
 *   LEASH_TEST_PLAN_METADATA_URI
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { mplCore } from '@metaplex-foundation/mpl-core';
import { findAssociatedTokenPda, mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  SPL_TOKEN_PROGRAM_ID,
  cancelNativeSubscription,
  collectNativeSubscription,
  createNativeSubscriptionPlan,
  deriveAgentTreasury,
  getNativeSubscriptionAuthority,
  getNativeSubscriptionPlan,
  initNativeSubscriptionAuthority,
  resumeNativeSubscription,
  revokeNativeSubscription,
  subscribeNativeSubscriptionPlan,
} from '@leashmarket/registry-utils';

const CONFIG_PATH =
  process.env.LEASH_TEST_PAYER_SECRET_KEY_FILE ?? join(homedir(), '.config', 'leash', 'agent.json');
const RPC = process.env.LEASH_TEST_RPC ?? 'https://api.devnet.solana.com';
const USDC = process.env.LEASH_TEST_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PLAN_USDC = process.env.LEASH_TEST_PLAN_USDC ?? '0.01';
const PERIOD_HOURS = BigInt(process.env.LEASH_TEST_PLAN_PERIOD_HOURS ?? '168');
const RPC_WAIT_MS = Number(process.env.LEASH_TEST_RPC_WAIT_MS ?? '15000');
const METADATA_URI =
  process.env.LEASH_TEST_PLAN_METADATA_URI ??
  'https://docs.leash.market/guides/native-subscriptions';

type AgentConfig = {
  agent_mint?: string;
  agentMint?: string;
  executiveSecretBase58?: string;
  executive_secret_base58?: string;
  executive_keypair?: unknown;
};

function readSecretInput(): string {
  if (process.env.LEASH_TEST_PAYER_SECRET_KEY) return process.env.LEASH_TEST_PAYER_SECRET_KEY;
  if (existsSync(CONFIG_PATH)) return readFileSync(CONFIG_PATH, 'utf8');
  throw new Error(
    `Set LEASH_TEST_PAYER_SECRET_KEY or LEASH_TEST_PAYER_SECRET_KEY_FILE; ${CONFIG_PATH} was not found.`,
  );
}

function readConfig(raw: string): AgentConfig | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  return JSON.parse(trimmed) as AgentConfig;
}

function decodeSecret(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return Uint8Array.from(JSON.parse(trimmed) as number[]);
  const cfg = readConfig(trimmed);
  if (cfg) {
    const b58 = cfg.executiveSecretBase58 ?? cfg.executive_secret_base58;
    if (b58) return base58.serialize(b58);
    if (typeof cfg.executive_keypair === 'string') return base58.serialize(cfg.executive_keypair);
    if (Array.isArray(cfg.executive_keypair)) {
      return Uint8Array.from(cfg.executive_keypair as number[]);
    }
    if (cfg.executive_keypair && typeof cfg.executive_keypair === 'object') {
      return Uint8Array.from(Object.values(cfg.executive_keypair as Record<string, number>));
    }
    throw new Error('Leash agent config does not contain an executive keypair.');
  }
  return base58.serialize(trimmed);
}

function resolveAgentMint(raw: string): string {
  const fromEnv = process.env.LEASH_TEST_AGENT_MINT;
  if (fromEnv) return fromEnv;
  const cfg = readConfig(raw);
  const fromConfig = cfg?.agent_mint ?? cfg?.agentMint;
  if (fromConfig) return fromConfig;
  throw new Error('Set LEASH_TEST_AGENT_MINT or use a Leash agent config with agent_mint.');
}

function decimalToAtomic(input: string, decimals = 6): bigint {
  const match = input.trim().match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Bad token decimal: ${input}`);
  const [, whole, fraction = ''] = match;
  if (fraction.length > decimals) {
    throw new Error(`Too many decimal places for ${decimals}-decimal mint: ${input}`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
}

function errText(e: unknown): string {
  const err = e as { message?: string; transactionLogs?: string[] };
  return [err.message, ...(err.transactionLogs ?? [])].filter(Boolean).join('\n');
}

function errLine(e: unknown): string {
  return errText(e).split('\n')[0] ?? String(e);
}

function isRevokeGracePeriodError(e: unknown): boolean {
  const t = errText(e);
  return t.includes('0x1fe') || t.includes('custom program error: 0x1fe');
}

async function waitPlan(
  umi: ReturnType<typeof createUmi>,
  owner: string,
  planId: bigint,
): Promise<string> {
  for (let i = 0; i < 25; i += 1) {
    const p = await getNativeSubscriptionPlan(umi, { owner, planId });
    if (p.exists) return p.plan;
    await sleep(1200);
  }
  throw new Error('plan not visible on RPC');
}

async function ensureTreasuryAuthority(args: {
  umi: ReturnType<typeof createUmi>;
  agent: string;
  treasury: string;
}): Promise<void> {
  const authority = await getNativeSubscriptionAuthority(args.umi, {
    owner: args.treasury,
    mint: USDC,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
  });
  if (authority.exists) {
    console.log('   treasury authority exists', authority.authority);
    return;
  }
  console.log('   treasury authority missing; initializing');
  const created = await initNativeSubscriptionAuthority(args.umi, {
    mint: USDC,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    fundingSource: 'treasury',
    agentAsset: args.agent,
  });
  console.log('   authority tx', created.signature);
  await sleep(RPC_WAIT_MS);
}

async function main(): Promise<void> {
  const secretInput = readSecretInput();
  const agent = resolveAgentMint(secretInput);
  const amount = decimalToAtomic(PLAN_USDC);

  const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(decodeSecret(secretInput))));

  const merchant = String(umi.identity.publicKey);
  const treasury = String(deriveAgentTreasury(umi, agent));
  const [merchantAta] = findAssociatedTokenPda(umi, {
    mint: publicKey(USDC),
    owner: publicKey(merchant),
    tokenProgramId: SPL_TOKEN_PROGRAM_ID,
  });

  console.log('───── leash native subscriptions lifecycle devnet ─────');
  console.log('rpc       :', RPC);
  console.log('agent     :', agent);
  console.log('merchant  :', merchant);
  console.log('treasury  :', treasury);
  console.log('mint      :', USDC);
  console.log('amount    :', `${PLAN_USDC} USDC = ${amount.toString()} atomic`);

  await ensureTreasuryAuthority({ umi, agent, treasury });

  const planId = BigInt(Math.floor(Date.now() / 1000));
  console.log('\n0 create plan', String(planId));
  const created = await createNativeSubscriptionPlan(umi, {
    mint: USDC,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    planId,
    amount,
    periodHours: PERIOD_HOURS,
    metadataUri: METADATA_URI,
  });
  console.log('   ok', created.signature);
  const plan = await waitPlan(umi, merchant, planId);
  console.log('   plan pda', plan);

  console.log('\n1 subscribe (treasury debit)');
  const sub = await subscribeNativeSubscriptionPlan(umi, {
    mint: USDC,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    merchant,
    planId,
    fundingSource: 'treasury',
    agentAsset: agent,
  });
  console.log('   ok', sub.subscription, sub.signature);
  console.log('   subscriber/debit owner', sub.subscriber);
  await sleep(RPC_WAIT_MS);

  console.log('\n2 collect');
  const col = await collectNativeSubscription(umi, {
    mint: USDC,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    plan,
    subscription: sub.subscription,
    amount,
    receiverTokenAccount: merchantAta,
    debitOwnerCandidates: [merchant, treasury],
  });
  console.log('   ok', col.signature, 'debit', col.debitOwner);

  console.log('\n3 cancel');
  const can = await cancelNativeSubscription(umi, {
    plan,
    subscription: sub.subscription,
    fundingSource: 'treasury',
    agentAsset: agent,
  });
  console.log('   ok', can.signature);
  await sleep(RPC_WAIT_MS);

  console.log('\n4 resume/reactivate');
  const res = await resumeNativeSubscription(umi, {
    plan,
    subscription: sub.subscription,
    fundingSource: 'treasury',
    agentAsset: agent,
  });
  console.log('   ok', res.signature);
  await sleep(RPC_WAIT_MS);

  // Program requires subscription to be cancelled before revoke (error 510 if active).
  console.log('\n5 cancel again (required before revoke)');
  const can2 = await cancelNativeSubscription(umi, {
    plan,
    subscription: sub.subscription,
    fundingSource: 'treasury',
    agentAsset: agent,
  });
  console.log('   ok', can2.signature);
  await sleep(RPC_WAIT_MS);

  console.log('\n6 revoke subscription guard');
  try {
    const rev = await revokeNativeSubscription(umi, {
      plan,
      subscription: sub.subscription,
      fundingSource: 'treasury',
      agentAsset: agent,
    });
    console.log('   ok', rev.signature);
  } catch (e) {
    if (!isRevokeGracePeriodError(e)) {
      console.log('   fail:', errLine(e));
      throw e;
    }
    console.log('   expected: revoke is allowed only after native cancel grace expires');
  }

  console.log('\nPASS — plan', plan, 'subscription', sub.subscription);
}

main().catch((e) => {
  console.error('FAIL', errLine(e));
  process.exit(1);
});
