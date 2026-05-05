/**
 * Static catalogue of the SPL stablecoins Leash treasuries
 * understand. Mirrors `apps/agents/lib/agents/leash-mcp.ts` so the
 * shared withdraw tool can resolve `mint`, `decimals`, and `program`
 * without taking a hard import dep on `@leash/core/tokens` (which
 * pulls in the full mpl-toolbox graph and is heavier than what an
 * MCP STDIO server should bundle).
 *
 * Mints + program ids are static and operationally stable; if a
 * stablecoin reissues, update the table here AND in
 * `apps/api/src/lib/faucet.ts::FAUCET_TOKENS`.
 */

export type TokenProgramId = 'spl-token' | 'spl-token-2022';

export type TokenMeta = {
  symbol: 'USDC' | 'USDG' | 'USDT';
  mint: string;
  decimals: number;
  program: TokenProgramId;
};

const CATALOG: Record<'mainnet' | 'devnet', Record<string, TokenMeta>> = {
  mainnet: {
    USDC: {
      symbol: 'USDC',
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
      program: 'spl-token',
    },
    USDT: {
      symbol: 'USDT',
      mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      decimals: 6,
      program: 'spl-token',
    },
    USDG: {
      symbol: 'USDG',
      mint: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
      decimals: 6,
      program: 'spl-token-2022',
    },
  },
  devnet: {
    USDC: {
      symbol: 'USDC',
      mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      decimals: 6,
      program: 'spl-token',
    },
    USDT: {
      symbol: 'USDT',
      mint: 'EcFc2cMyZxaKBkFK1XooxiyDyCPneLXiMwSJiVY6eTad',
      decimals: 6,
      program: 'spl-token',
    },
    USDG: {
      symbol: 'USDG',
      mint: '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7',
      decimals: 6,
      program: 'spl-token-2022',
    },
  },
};

/**
 * Look up a stablecoin by symbol on the requested cluster. Returns
 * `null` when the symbol isn't catalogued — callers should surface a
 * "try USDC/USDG/USDT" error verbatim to the model.
 */
export function lookupTokenBySymbolSafe(
  symbol: string,
  network: 'mainnet' | 'devnet',
): TokenMeta | null {
  const upper = symbol.trim().toUpperCase();
  const hit = CATALOG[network][upper];
  if (!hit) return null;
  return hit;
}

/**
 * Reverse-lookup: given an SPL mint, return the catalogued ticker
 * (`USDC` | `USDG` | `USDT`) or `null` when the mint is unknown. Used
 * by `probePaymentLink` to label an x402 quote correctly when the
 * seller omits the optional `currency` field — without this we were
 * mis-labelling USDG/USDT links as USDC, then asking buyer-kit to
 * pay in the wrong asset (`preferred_asset_unavailable`).
 */
export function symbolForMintSafe(
  mint: string,
  network: 'mainnet' | 'devnet',
): TokenMeta['symbol'] | null {
  const trimmed = mint.trim();
  for (const meta of Object.values(CATALOG[network])) {
    if (meta.mint === trimmed) return meta.symbol;
  }
  return null;
}
