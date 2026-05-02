#!/usr/bin/env tsx
/**
 * One-shot remediation for sandbox-minted agents that pre-date the
 * delegation fix in `apps/api/src/routes/agent-self-register.ts`.
 *
 * Symptom: `leash_pay_payment_link` returns
 *   `{ status: 'error', error: 'no_delegate: transaction_simulation_failed' }`
 * even though the treasury holds USDC. The buyer-kit signs as the
 * delegate of the agent's USDC ATA; sandbox flows that pre-date the
 * fix never ran the `mpl-core::Execute(SPL.Approve)` step.
 *
 * Usage
 * -----
 *   pnpm --filter @leash/mcp fix-delegation
 *
 * Env / config
 * ------------
 *   - Reads `~/.config/leash/agent.json` (the standard MCP config).
 *   - Override anything via env: LEASH_AGENT_MINT, LEASH_EXECUTIVE_KEY,
 *     LEASH_NETWORK, LEASH_RPC_URL.
 *
 * What it does
 * ------------
 *   1. Builds a Umi instance whose identity is the executive keypair.
 *   2. Calls `setSpendDelegation` with `u64::MAX` (unlimited) on the
 *      USDC ATA for the active network.
 *   3. Prints the resulting tx signature + Solscan URL.
 *
 * Idempotency: re-running just refreshes the delegation. Safe.
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { KNOWN_STABLES, SPL_TOKEN_PROGRAM_ID, setSpendDelegation } from '@leash/registry-utils';

import { loadAgentConfig } from '../src/config.js';

async function main() {
  const cfg = loadAgentConfig();
  if (!cfg) {
    console.error('No agent config found.');
    console.error('Either populate ~/.config/leash/agent.json (run `leash_register_agent`)');
    console.error('or set LEASH_AGENT_MINT + LEASH_EXECUTIVE_KEY env vars.');
    process.exit(2);
  }

  console.log('agent       :', cfg.agentMint);
  console.log('network     :', cfg.network);
  console.log('rpc         :', cfg.rpcUrl);

  const secret = base58.serialize(cfg.executiveSecretBase58);
  if (secret.length !== 64) {
    console.error(`executive secret must decode to 64 bytes (got ${secret.length})`);
    process.exit(1);
  }

  const umi = createUmi(cfg.rpcUrl).use(mplCore()).use(mplToolbox());
  const kp = umi.eddsa.createKeypairFromSecretKey(secret);
  umi.use(keypairIdentity(kp));

  const usdc = KNOWN_STABLES[cfg.network].find((s) => s.symbol === 'USDC');
  if (!usdc) {
    console.error(`USDC not configured for ${cfg.network}`);
    process.exit(1);
  }

  console.log('USDC mint   :', String(usdc.mint));
  console.log('executive   :', String(kp.publicKey));
  console.log('cap         : u64::MAX (unlimited)');
  console.log();

  const t0 = Date.now();
  const result = await setSpendDelegation(umi, {
    agentAsset: cfg.agentMint,
    mint: usdc.mint,
    executive: String(kp.publicKey),
    amount: 2n ** 64n - 1n,
    tokenProgram: usdc.tokenProgram ?? SPL_TOKEN_PROGRAM_ID,
  });
  const elapsed = Date.now() - t0;

  const cluster = cfg.network === 'solana-mainnet' ? '' : '?cluster=devnet';
  console.log('OK');
  console.log('  signature      :', result.signature);
  console.log('  treasury       :', result.treasury);
  console.log('  source ATA     :', result.sourceTokenAccount);
  console.log('  delegated to   :', result.delegate);
  console.log('  delegated amt  :', String(result.delegatedAmount), 'atomic');
  console.log('  elapsed        :', elapsed, 'ms');
  console.log('  solscan        :', `https://solscan.io/tx/${result.signature}${cluster}`);
  console.log();
  console.log('You can now retry `leash_pay_payment_link`.');
}

main().catch((err) => {
  console.error('FAILED');
  console.error(err);
  process.exit(1);
});
