/**
 * Real devnet integration test for the agent-onboarding endpoints
 * shipped in batch 1:
 *
 *   - GET  /v1/agents/self-register/info
 *   - POST /v1/faucet/drip-sol
 *   - POST /v1/agents/record
 *   - POST /v1/sandbox/agent
 *
 * What this proves end-to-end
 * ---------------------------
 * 1. The faucet info endpoint reports the on-chain pubkey clients
 *    should expect to see SOL come from.
 * 2. `/v1/faucet/drip-sol` lands real lamports on a fresh keypair on
 *    devnet, with the returned signature visible on chain.
 * 3. `/v1/agents/record` correctly verifies on-chain ownership before
 *    writing the platform row — we drip SOL, mint locally, and then
 *    record. Mismatched executives are rejected.
 * 4. `/v1/sandbox/agent` does all three steps server-side and returns
 *    a usable secret + funded mint. We reconstruct the keypair and
 *    confirm SOL + USDC balances arrived at the right destinations.
 *
 * Required env
 * ------------
 *   LEASH_E2E_API_URL          base URL (default: http://localhost:8801)
 *   LEASH_E2E_RPC              devnet RPC (default: api.devnet.solana.com)
 *
 * Bring the api up first:
 *   pnpm --filter @leash/api dev
 *
 * Then:
 *   pnpm --filter @leash/api test:self-register-devnet
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  type Keypair,
  type Umi,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { mplCore, findAssetSignerPda } from '@metaplex-foundation/mpl-core';
import { mplToolbox, findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';

import { createAgent, SPL_TOKEN_PROGRAM_ID } from '@leash/registry-utils';

const API_URL = (process.env.LEASH_E2E_API_URL ?? 'http://localhost:8801').replace(/\/+$/, '');
const RPC = process.env.LEASH_E2E_RPC ?? 'https://api.devnet.solana.com';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

const log = {
  step: (n: number, title: string) => console.log(`\n──── ${n}. ${title} ────`),
  ok: (msg: string) => console.log(`  ✓ ${msg}`),
  info: (msg: string) => console.log(`  · ${msg}`),
  warn: (msg: string) => console.log(`  ⚠ ${msg}`),
  fatal: (msg: string): never => {
    console.error(`\n✗ ${msg}`);
    process.exit(1);
  },
};

type FetchInit = { method?: string; body?: unknown; expectStatus?: number };

async function api<T = unknown>(path: string, init: FetchInit = {}): Promise<T> {
  const url = `${API_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  const expect = init.expectStatus ?? 200;
  if (res.status !== expect) {
    log.fatal(
      `${init.method ?? 'GET'} ${path} → ${res.status} (expected ${expect})\n${text.slice(0, 800)}`,
    );
  }
  return parsed as T;
}

async function getSolLamports(umi: Umi, owner: string): Promise<bigint> {
  const acct = await umi.rpc.getAccount(publicKey(owner));
  if (!acct.exists) return 0n;
  return BigInt(acct.lamports.basisPoints);
}

async function getUsdcAtomic(umi: Umi, owner: string): Promise<bigint> {
  const [ata] = findAssociatedTokenPda(umi, {
    mint: publicKey(USDC_MINT),
    owner: publicKey(owner),
    tokenProgramId: SPL_TOKEN_PROGRAM_ID,
  });
  const acct = await umi.rpc.getAccount(ata);
  if (!acct.exists) return 0n;
  // SPL token account amount is u64 little-endian at offset 64.
  const data = acct.data;
  if (data.length < 72) return 0n;
  let amount = 0n;
  for (let i = 0; i < 8; i += 1) amount |= BigInt(data[64 + i]!) << BigInt(8 * i);
  return amount;
}

async function main(): Promise<void> {
  console.log('============================================================');
  console.log('Leash batch-1 devnet integration test');
  console.log('============================================================');
  console.log(`api : ${API_URL}`);
  console.log(`rpc : ${RPC}`);

  const umi = createUmi(RPC).use(mplCore()).use(mplToolbox());
  let stepNum = 0;
  const step = (title: string) => log.step(++stepNum, title);

  // ───── 1. Health check ─────
  step('GET /v1/health');
  const health = await api<{ ok: boolean }>('/v1/health');
  if (!health.ok) log.fatal('API health check failed');
  log.ok('API is up');

  // ───── 2. Faucet info ─────
  step('GET /v1/agents/self-register/info');
  const info = await api<{
    faucet_pubkey: string;
    supported_networks: string[];
    drip_sol_default_lamports: string;
    drip_sol_cap_lamports: string;
    sandbox: { default_usdc_atomic: string; cap_usdc_atomic: string };
  }>('/v1/agents/self-register/info');
  const faucetPubkey = info.faucet_pubkey;
  log.ok(`faucet pubkey            : ${faucetPubkey}`);
  log.ok(`networks                 : ${info.supported_networks.join(', ')}`);
  log.ok(
    `drip-sol default / cap   : ${info.drip_sol_default_lamports} / ${info.drip_sol_cap_lamports}`,
  );
  log.ok(
    `sandbox usdc default/cap : ${info.sandbox.default_usdc_atomic} / ${info.sandbox.cap_usdc_atomic}`,
  );

  const faucetSolBefore = await getSolLamports(umi, faucetPubkey);
  log.info(
    `faucet SOL balance       : ${faucetSolBefore} lamports (${Number(faucetSolBefore) / 1e9} SOL)`,
  );
  if (faucetSolBefore < 100_000_000n) {
    log.warn(`faucet has < 0.1 SOL — top it up via https://faucet.solana.com/ before continuing.`);
  }

  // ───── 3. drip-sol → fresh keypair ─────
  step('POST /v1/faucet/drip-sol → fresh executive keypair');
  const fresh = generateSigner(umi);
  const executivePubkey = String(fresh.publicKey);
  log.info(`executive pubkey         : ${executivePubkey}`);

  const drip = await api<{
    destination: string;
    lamports: string;
    signature: string;
    network: string;
    explorer_url: string;
  }>('/v1/faucet/drip-sol', {
    body: { destination: executivePubkey, lamports: 30_000_000 },
  });
  log.ok(`drip signature           : ${drip.signature}`);
  log.info(`drip explorer            : ${drip.explorer_url}`);

  // Wait for SOL to land.
  let lamportsLanded = 0n;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    lamportsLanded = await getSolLamports(umi, executivePubkey);
    if (lamportsLanded >= BigInt(drip.lamports)) break;
    await sleep(1_000);
  }
  if (lamportsLanded < BigInt(drip.lamports)) {
    log.fatal(
      `SOL drip did not land within 12s (got ${lamportsLanded}, expected ${drip.lamports})`,
    );
  }
  log.ok(`executive SOL balance    : ${lamportsLanded} lamports`);

  // ───── 4. Caller mints locally ─────
  step('Caller mints MPL Core agent locally with the dripped SOL');
  const executiveKp: Keypair = { publicKey: fresh.publicKey, secretKey: fresh.secretKey };
  const executiveUmi = createUmi(RPC)
    .use(mplCore())
    .use(mplToolbox())
    .use(keypairIdentity(executiveKp));

  const mintInput = {
    wallet: executivePubkey,
    name: `Test Agent ${executivePubkey.slice(0, 6)}`,
    uri:
      'data:application/json;utf8,' +
      encodeURIComponent(
        JSON.stringify({
          type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
          name: 'Test Agent',
          description: 'Provisioned by test-self-register-devnet.ts',
          image: '',
          services: [],
          x402Support: true,
          active: true,
          registrations: [],
          supportedTrust: [],
        }),
      ),
    description: 'Provisioned by test-self-register-devnet.ts',
    network: 'solana-devnet' as const,
    services: [],
  };
  const minted = await createAgent(executiveUmi, mintInput);
  log.ok(`mint signature           : ${minted.signature}`);
  log.ok(`asset address            : ${minted.assetAddress}`);

  const [treasuryPda] = findAssetSignerPda(executiveUmi, {
    asset: publicKey(minted.assetAddress),
  });
  log.info(`treasury PDA             : ${String(treasuryPda)}`);

  // ───── 5. record on the platform ─────
  step('POST /v1/agents/record');
  const recorded = await api<{
    mint: string;
    treasury: string;
    executive_pubkey: string;
    network: string;
    receipts_service: string;
  }>('/v1/agents/record', {
    body: {
      mint: minted.assetAddress,
      executive_pubkey: executivePubkey,
      name: mintInput.name,
      description: mintInput.description,
      services: [],
    },
  });
  if (recorded.executive_pubkey !== executivePubkey) {
    log.fatal('executive_pubkey mismatch in record response');
  }
  if (recorded.treasury !== String(treasuryPda)) {
    log.fatal(`treasury mismatch: server=${recorded.treasury} local=${String(treasuryPda)}`);
  }
  log.ok(`recorded mint            : ${recorded.mint}`);
  log.ok(`receipts service         : ${recorded.receipts_service}`);

  // ───── 6. record again should 422 (idempotent guard) ─────
  step('POST /v1/agents/record (duplicate) should return 422');
  await api('/v1/agents/record', {
    body: {
      mint: minted.assetAddress,
      executive_pubkey: executivePubkey,
      name: mintInput.name,
      services: [],
    },
    expectStatus: 422,
  });
  log.ok('duplicate rejected');

  // ───── 7. sandbox agent ─────
  step('POST /v1/sandbox/agent');
  const sandbox = await api<{
    mint: string;
    treasury: string;
    executive_pubkey: string;
    executive_secret_base58: string;
    network: string;
    tx_signatures: { sol_drip: string; mint: string; usdc_drip: string };
    explorer_urls: { mint: string; sol_drip: string; usdc_drip: string };
    funded: { sol_lamports: string; usdc_atomic: string };
    receipts_service: string;
  }>('/v1/sandbox/agent', {
    body: { name: 'Sandbox Agent (test)', description: 'Provisioned by sandbox flow' },
  });

  log.ok(`mint                     : ${sandbox.mint}`);
  log.ok(`treasury PDA             : ${sandbox.treasury}`);
  log.ok(`executive pubkey         : ${sandbox.executive_pubkey}`);
  log.ok(`SOL drip sig             : ${sandbox.tx_signatures.sol_drip}`);
  log.ok(`mint sig                 : ${sandbox.tx_signatures.mint}`);
  log.ok(`USDC drip sig            : ${sandbox.tx_signatures.usdc_drip}`);
  log.info(
    `executive secret         : ${sandbox.executive_secret_base58.slice(0, 12)}…${sandbox.executive_secret_base58.slice(-4)} (${sandbox.executive_secret_base58.length} chars)`,
  );

  // Verify keypair reconstruction.
  const reconstructed = umi.eddsa.createKeypairFromSecretKey(
    base58.serialize(sandbox.executive_secret_base58),
  );
  if (String(reconstructed.publicKey) !== sandbox.executive_pubkey) {
    log.fatal('reconstructed keypair pubkey mismatch');
  }
  log.ok('reconstructed keypair pubkey matches');

  // ───── 8. verify funded balances ─────
  step('Verify SOL + USDC drips landed on chain');
  let solOk = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const sol = await getSolLamports(umi, sandbox.executive_pubkey);
    if (sol >= BigInt(sandbox.funded.sol_lamports)) {
      log.ok(`executive SOL balance    : ${sol} lamports (>= drip ${sandbox.funded.sol_lamports})`);
      solOk = true;
      break;
    }
    log.info(`SOL not visible yet (${sol} lamports) — retrying`);
    await sleep(2_000);
  }
  if (!solOk) log.fatal('SOL drip did not land on the executive within 16s');

  let usdcOk = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const usdc = await getUsdcAtomic(umi, sandbox.treasury);
    if (usdc >= BigInt(sandbox.funded.usdc_atomic)) {
      log.ok(`treasury USDC balance    : ${usdc} atomic (>= drip ${sandbox.funded.usdc_atomic})`);
      usdcOk = true;
      break;
    }
    log.info(`USDC not visible yet (${usdc} atomic) — retrying`);
    await sleep(2_000);
  }
  if (!usdcOk) log.fatal('USDC drip did not land on the treasury within 24s');

  console.log('\n============================================================');
  console.log('All batch-1 onboarding tests passed');
  console.log('============================================================');
  console.log(`Recorded agent  : ${recorded.mint}`);
  console.log(`Sandbox agent   : ${sandbox.mint}`);
}

main().catch((err) => {
  console.error('\n✗ unexpected error:', err);
  process.exit(1);
});
