/**
 * Kit-native helpers to derive the agent treasury (Asset Signer PDA) and the
 * treasury's SPL token ATA for a given mint. These mirror what `mpl-core`'s
 * `findAssetSignerPda` does (seeds = `["mpl-core-execute", asset]`, program =
 * `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`) but using `@solana/kit`
 * primitives so consumers (e.g. `@leash/buyer-kit`) can derive the source
 * token account without dragging in the Umi runtime.
 *
 * Used by `createBuyer` to surface precise pre-flight failure reasons
 * (`insufficient_balance`, `insufficient_allowance`, `no_delegate`, etc.)
 * even when the caller didn't pre-cache the source ATA.
 */
import {
  address as toAddress,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from '@solana/kit';
import { findAssociatedTokenPda, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';

/** Metaplex Core program ID — owns the Asset Signer PDA. */
export const MPL_CORE_PROGRAM_ADDRESS = toAddress(
  'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d',
) as Address;

/**
 * Derive the agent treasury (Asset Signer PDA) for a Metaplex Core asset.
 *
 * Seeds match the on-chain program: `["mpl-core-execute", asset_pubkey]`.
 * Wire-compatible with `@metaplex-foundation/mpl-core`'s
 * {@link findAssetSignerPda} but Umi-free.
 */
export async function deriveAgentTreasuryAddress(asset: string | Address): Promise<Address> {
  const assetAddress = typeof asset === 'string' ? (toAddress(asset) as Address) : asset;
  const [pda] = await getProgramDerivedAddress({
    programAddress: MPL_CORE_PROGRAM_ADDRESS,
    seeds: [new TextEncoder().encode('mpl-core-execute'), getAddressEncoder().encode(assetAddress)],
  });
  return pda;
}

/**
 * Derive the treasury's Associated Token Account for `mint`. Pass
 * `tokenProgram = TOKEN_2022_PROGRAM_ADDRESS` for Token-2022 mints; defaults
 * to legacy SPL Token (USDC, USDT, USDG on Solana mainnet & devnet).
 */
export async function deriveAgentTreasuryAta(args: {
  asset: string | Address;
  mint: string | Address;
  tokenProgram?: Address;
}): Promise<{ treasury: Address; ata: Address }> {
  const treasury = await deriveAgentTreasuryAddress(args.asset);
  const mint = typeof args.mint === 'string' ? (toAddress(args.mint) as Address) : args.mint;
  const tokenProgram = args.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
  const [ata] = await findAssociatedTokenPda({ mint, owner: treasury, tokenProgram });
  return { treasury, ata };
}

/** Re-export common token program addresses so consumers don't have to depend on both `@solana-program/*` packages. */
export { TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS };
