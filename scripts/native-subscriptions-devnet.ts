/**
 * Real devnet smoke for Solana native Subscriptions & Allowances.
 *
 * Required:
 *   LEASH_TEST_PAYER_SECRET_KEY       base58 OR JSON-array secret
 *
 * Optional:
 *   LEASH_TEST_PAYER_SECRET_KEY_FILE  file containing the same secret format
 *                                     defaults to ~/.config/leash/agent.json
 *   LEASH_TEST_RPC                    defaults to https://api.devnet.solana.com
 *   LEASH_TEST_USDC_MINT              defaults to Circle devnet USDC
 *   LEASH_TEST_PLAN_ID                defaults to current unix seconds
 *   LEASH_TEST_PLAN_USDC              defaults to 0.001
 *   LEASH_TEST_PLAN_PERIOD_HOURS      defaults to 1
 *   LEASH_TEST_PLAN_METADATA_URI      defaults to the Leash native subscriptions guide
 *
 * The script never logs the private key. It initializes the signer wallet's
 * native subscription authority for devnet USDC, creates a real subscription
 * plan, then creates and revokes a tiny fixed allowance to a throwaway
 * delegate pubkey.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { generateSigner, keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS,
  SPL_TOKEN_PROGRAM_ID,
  createNativeFixedAllowance,
  createNativeSubscriptionPlan,
  getNativeSubscriptionAuthority,
  initNativeSubscriptionAuthority,
  revokeNativeAllowance,
} from '@leashmarket/registry-utils';

const RPC = process.env.LEASH_TEST_RPC ?? 'https://api.devnet.solana.com';
const USDC = process.env.LEASH_TEST_USDC_MINT ?? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const PLAN_ID = BigInt(process.env.LEASH_TEST_PLAN_ID ?? Math.floor(Date.now() / 1000));
const PLAN_USDC = process.env.LEASH_TEST_PLAN_USDC ?? '0.001';
const PERIOD_HOURS = BigInt(process.env.LEASH_TEST_PLAN_PERIOD_HOURS ?? '1');
const METADATA_URI =
  process.env.LEASH_TEST_PLAN_METADATA_URI ??
  'https://docs.leash.market/guides/native-subscriptions';

function readSecret(): string {
  if (process.env.LEASH_TEST_PAYER_SECRET_KEY) return process.env.LEASH_TEST_PAYER_SECRET_KEY;
  const file = process.env.LEASH_TEST_PAYER_SECRET_KEY_FILE;
  if (file && existsSync(file)) return readFileSync(file, 'utf8');
  const configPath = join(homedir(), '.config', 'leash', 'agent.json');
  if (existsSync(configPath)) return readFileSync(configPath, 'utf8');
  throw new Error(
    'Set LEASH_TEST_PAYER_SECRET_KEY or LEASH_TEST_PAYER_SECRET_KEY_FILE (base58, JSON byte array, or Leash agent config).',
  );
}

function decodeSecret(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) return Uint8Array.from(JSON.parse(trimmed) as number[]);
  if (trimmed.startsWith('{')) {
    const config = JSON.parse(trimmed) as {
      executive_keypair?: unknown;
      executiveKeypair?: unknown;
      executiveSecretBase58?: string;
      executive_secret_base58?: string;
    };
    const base58Secret = config.executiveSecretBase58 ?? config.executive_secret_base58;
    if (base58Secret) return base58.serialize(base58Secret);
    const keypair = config.executive_keypair ?? config.executiveKeypair;
    if (typeof keypair === 'string') return base58.serialize(keypair);
    if (Array.isArray(keypair)) return Uint8Array.from(keypair as number[]);
    if (keypair && typeof keypair === 'object') {
      return Uint8Array.from(Object.values(keypair as Record<string, number>));
    }
    throw new Error('Leash agent config does not contain an executive keypair.');
  }
  return base58.serialize(trimmed);
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

async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
): Promise<T> {
  let latest = await read();
  if (isReady(latest)) return latest;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await sleep(1_000);
    latest = await read();
    if (isReady(latest)) return latest;
  }
  throw new Error(`${label} was not visible on RPC after waiting.`);
}

async function main(): Promise<void> {
  const secret = decodeSecret(readSecret());
  const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
  umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

  const owner = String(umi.identity.publicKey);
  const mint = publicKey(USDC);
  const amount = decimalToAtomic(PLAN_USDC);

  console.log('───── leash native subscriptions devnet smoke ─────');
  console.log('rpc        :', RPC);
  console.log('program    :', NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS);
  console.log('owner      :', owner);
  console.log('mint       :', USDC);
  console.log('plan id    :', PLAN_ID.toString());
  console.log('plan amount:', `${PLAN_USDC} USDC = ${amount.toString()} atomic`);

  let authority = await getNativeSubscriptionAuthority(umi, {
    owner: umi.identity.publicKey,
    mint,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
  });

  if (!authority.exists) {
    console.log('authority  : missing, initializing...');
    const created = await initNativeSubscriptionAuthority(umi, {
      mint,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
    });
    console.log('authority tx:', created.signature);
    authority = await waitFor(
      'Native subscription authority',
      () =>
        getNativeSubscriptionAuthority(umi, {
          owner: umi.identity.publicKey,
          mint,
          tokenProgram: SPL_TOKEN_PROGRAM_ID,
        }),
      (value) => value.exists,
    );
  } else {
    console.log('authority  : exists');
  }

  if (!authority.exists) {
    throw new Error('Native subscription authority was not found after initialization.');
  }
  console.log('authority pda:', authority.authority);
  console.log('init id      :', authority.initId?.toString() ?? '(missing)');

  const plan = await createNativeSubscriptionPlan(umi, {
    mint,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    planId: PLAN_ID,
    amount,
    periodHours: PERIOD_HOURS,
    metadataUri: METADATA_URI,
  });
  console.log('plan tx     :', plan.signature);
  console.log('plan pda    :', plan.plan);

  const planAccount = await waitFor(
    'Subscription plan',
    () => umi.rpc.getAccount(publicKey(plan.plan)),
    (value) => value.exists,
  );
  console.log(
    'plan status :',
    planAccount.exists ? `created (${planAccount.data.length} bytes)` : 'missing',
  );

  const delegatee = generateSigner(umi).publicKey;
  const allowance = await createNativeFixedAllowance(umi, {
    mint,
    tokenProgram: SPL_TOKEN_PROGRAM_ID,
    delegatee,
    amount,
    nonce: PLAN_ID,
  });
  console.log('fixed tx    :', allowance.signature);
  console.log('fixed pda   :', allowance.allowance);

  await waitFor(
    'Fixed allowance',
    () => umi.rpc.getAccount(publicKey(allowance.allowance)),
    (value) => value.exists,
  );

  const revoked = await revokeNativeAllowance(umi, {
    allowance: allowance.allowance,
  });
  console.log('revoke tx   :', revoked.signature);
  console.log('done        : native authority, plan, fixed allowance, and revoke all succeeded');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
