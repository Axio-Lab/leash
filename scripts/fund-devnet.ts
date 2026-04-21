/**
 * Devnet helper: airdrop SOL to a pubkey (USDC mint step is TODO — wire SPL token when needed).
 *
 * Usage: pnpm exec tsx scripts/fund-devnet.ts <PUBKEY>
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

const rpc = process.env.SOLANA_RPC ?? 'https://api.devnet.solana.com';

async function main(): Promise<void> {
  const pk = process.argv[2];
  if (!pk) {
    console.error('Usage: fund-devnet.ts <base58-pubkey>');
    process.exit(2);
  }
  const to = new PublicKey(pk);
  const conn = new Connection(rpc, 'confirmed');
  const sig = await conn.requestAirdrop(to, 1 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
  console.log('Airdropped 1 SOL to', to.toBase58(), sig);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
