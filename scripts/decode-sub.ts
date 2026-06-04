import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { getNativeSubscription } from '@leashmarket/registry-utils';

function decodeSecret(raw: string): Uint8Array {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) {
    const cfg = JSON.parse(trimmed) as {
      executiveSecretBase58?: string;
      executive_secret_base58?: string;
      executive_keypair?: string;
    };
    const b58 = cfg.executiveSecretBase58 ?? cfg.executive_secret_base58;
    if (b58) return base58.serialize(b58);
    if (typeof cfg.executive_keypair === 'string') return base58.serialize(cfg.executive_keypair);
  }
  return base58.serialize(trimmed);
}
const raw = readFileSync(join(homedir(), '.config/leash/agent.json'), 'utf8');
const secret = decodeSecret(raw);
const umi = createUmi('https://api.devnet.solana.com').use(mplCore()).use(mplToolbox());
umi.use(keypairIdentity(umi.eddsa.createKeypairFromSecretKey(secret)));

const sub = await getNativeSubscription(umi, {
  plan: process.argv[2] ?? 'C6dScQRTaWWBLVSZbBUGjzQ2AXCbhSqPBx9wdgaFXH7c',
  subscriber: process.argv[3] ?? '813PRq9mP715QicVHFigFwS5fEeMmGTVS7R7QXATi7FD',
});
console.log(JSON.stringify(sub, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
