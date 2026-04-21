import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

export async function getSplTokenBalance(
  connection: Connection,
  ownerBase58: string,
  mintBase58: string,
): Promise<bigint> {
  const owner = new PublicKey(ownerBase58);
  const mint = new PublicKey(mintBase58);
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });
  let sum = 0n;
  for (const { account } of accounts.value) {
    const amount = account.data.parsed.info.tokenAmount.amount;
    sum += BigInt(amount);
  }
  return sum;
}
