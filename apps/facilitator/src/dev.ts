/**
 * Development entrypoint for `@leashmarket/facilitator-app`. Convenience
 * wrapper over the `@leashmarket/facilitator` CLI that prints clearer
 * onboarding errors and (optionally) loads `.env` for local dev.
 *
 * In production, run the published `leash-facilitator` binary from
 * `@leashmarket/facilitator` (see `package.json` `start` script).
 */
import { serve } from '@hono/node-server';
import { createLeashFacilitator, parseNetworksEnv } from '@leashmarket/facilitator';

if (!process.env.LEASH_FACILITATOR_SECRET_KEY) {
  console.error(
    '[facilitator-app] LEASH_FACILITATOR_SECRET_KEY missing.\n' +
      '  Generate a devnet key: solana-keygen new -o .leash-fee-payer.json\n' +
      '  Then export: LEASH_FACILITATOR_SECRET_KEY="$(cat .leash-fee-payer.json)"\n' +
      '  Fund it via https://faucet.solana.com',
  );
  process.exit(1);
}

const port = Number(process.env.LEASH_FACILITATOR_PORT ?? 8787);
const host = process.env.LEASH_FACILITATOR_HOST ?? '0.0.0.0';

const { app, signer, caip2Networks } = await createLeashFacilitator({
  secretKey: process.env.LEASH_FACILITATOR_SECRET_KEY,
  networks: parseNetworksEnv(process.env.LEASH_FACILITATOR_NETWORKS),
  defaultRpcUrl: process.env.LEASH_FACILITATOR_RPC_URL,
});

serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`[facilitator-app] dev server on http://${host}:${info.port}`);
  console.log(`[facilitator-app] networks: ${caip2Networks.join(', ')}`);
  console.log(`[facilitator-app] fee payer: ${signer.addresses.join(', ')}`);
});
