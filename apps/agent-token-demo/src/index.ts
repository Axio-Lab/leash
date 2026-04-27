/**
 * agent-token-demo — End-to-end Genesis launch driven by Leash SDK.
 *
 * Mirrors the Metaplex docs flow ("Create an Agent Token") from a CLI:
 *
 *   1. Read a Solana keypair from the env (the agent owner that will pay
 *      the launch fees).
 *   2. Read the on-chain Agent Identity for the asset to confirm whether
 *      the agent already has a token (we never overwrite — `setToken` is
 *      irreversible).
 *   3. Call `launchAgentToken` with sensible defaults (devnet, no
 *      `setToken` flip, no first buy) so the demo prints a Metaplex
 *      launch link without locking anyone in by accident.
 *   4. Print every transaction signature with a Solscan link so the
 *      reader can verify the chain side end-to-end.
 *
 * Why a CLI demo instead of a server? `launchAgentToken` is a one-shot
 * write — once the launch lands the action is done. A long-running
 * server adds nothing.
 *
 * Env vars (see `./launch-input.ts` for full schema). Required:
 *   - `LEASH_OWNER_SECRET_KEY`  — JSON array of 64 bytes (Solana keypair).
 *   - `LEASH_AGENT_ASSET`       — Core asset address of the agent.
 *   - `LEASH_TOKEN_IMAGE`       — HTTPS URL for the token image (Metaplex Genesis rules).
 *
 * Run:
 *
 *   pnpm --filter @leash/agent-token-demo build
 *   LEASH_OWNER_SECRET_KEY=... LEASH_AGENT_ASSET=... LEASH_TOKEN_IMAGE=... \
 *   pnpm --filter @leash/agent-token-demo start
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { launchAgentToken, getAgentToken } from '@leash/registry-utils';
import { buildLaunchInput, explorerCluster, readDemoConfig } from './launch-input.js';

async function main() {
  const cfg = readDemoConfig(process.env);

  const umi = createUmi(cfg.rpc).use(mplCore());
  const kp = umi.eddsa.createKeypairFromSecretKey(cfg.secret);
  umi.use(keypairIdentity(kp));

  console.log('agent-token-demo: configuration');
  console.log('  network        :', cfg.network);
  console.log('  rpc            :', cfg.rpc);
  console.log('  agent asset    :', cfg.agentAsset);
  console.log('  owner wallet   :', String(umi.identity.publicKey));
  console.log('  token name     :', cfg.tokenName);
  console.log('  token symbol   :', cfg.tokenSymbol);
  console.log('  token image    :', cfg.tokenImage);
  console.log('  set token      :', cfg.setToken);
  console.log('  first buy SOL  :', cfg.firstBuyAmount || '0');

  const status = await getAgentToken(umi, publicKey(cfg.agentAsset));
  console.log('\nagent-token-demo: pre-flight');
  console.log('  identity source:', status.source);
  console.log('  has token      :', status.hasToken);
  console.log('  current mint   :', status.mint ?? '(none)');
  console.log('  treasury PDA   :', status.treasury);

  if (status.hasToken && cfg.setToken) {
    console.error(
      '\nagent-token-demo: refusing to launch with setToken=true — agent already has',
      status.mint,
      '(setAgentTokenV1 is irreversible).',
    );
    process.exit(2);
  }

  const launchInput = buildLaunchInput(cfg);

  console.log('\nagent-token-demo: launching ...');
  const result = await launchAgentToken(umi, launchInput);

  console.log('\nagent-token-demo: launch landed');
  console.log('  mint           :', result.mintAddress);
  console.log('  genesis acct   :', result.genesisAccount);
  console.log('  launch link    :', result.launch.link);
  console.log('  agent bound?   :', result.agentTokenSet);
  console.log(`  signatures     : ${result.signatures.length}`);
  for (const sig of result.signatures) {
    console.log(
      `    https://solscan.io/tx/${sig}?cluster=${explorerCluster(cfg.network)}  (${sig})`,
    );
  }

  const after = await getAgentToken(umi, publicKey(cfg.agentAsset));
  console.log('\nagent-token-demo: post-flight');
  console.log('  has token      :', after.hasToken);
  console.log('  current mint   :', after.mint ?? '(none)');
  if (cfg.setToken && !after.hasToken) {
    console.warn(
      'agent-token-demo: WARN — setToken=true but on-chain agentToken is still empty. RPC lag? Try `getAgentToken` again in a few seconds.',
    );
  }
}

main().catch((err) => {
  console.error('agent-token-demo: failed');
  console.error(err);
  process.exit(1);
});
