/**
 * Static registry of well-known SPL token mints used by the Leash UI / CLI
 * surfaces to enrich raw RPC balances with symbols, decimals, and the
 * correct token program id. The registry deliberately stays small —
 * stables + bluechips that are policy-relevant for x402 / agent treasuries.
 *
 * For full registry resolution (Token-2022 metadata, Jupiter token list,
 * etc.) consume an external source; this module covers the common case so
 * SDK consumers never need to hard-code mint addresses.
 *
 * Mainnet and devnet entries are listed separately because devnet stables
 * are usually faucet-mintable test versions with different mint authorities
 * than their mainnet counterparts.
 */

export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export type TokenProgram = 'spl-token' | 'spl-token-2022';
export type TokenNetwork = 'mainnet' | 'devnet';

export type KnownToken = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  /**
   * SPL token program owning this mint. Defaults to legacy `spl-token` when
   * omitted by callers; explicit on every entry below for clarity.
   */
  program: TokenProgram;
  /** True when the token is a USD-pegged stablecoin. */
  stable: boolean;
};

const MAINNET: ReadonlyArray<KnownToken> = [
  {
    mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    program: 'spl-token',
    stable: true,
  },
  {
    mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    program: 'spl-token',
    stable: true,
  },
  {
    mint: '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH',
    symbol: 'USDG',
    name: 'Global Dollar',
    decimals: 6,
    program: 'spl-token-2022',
    stable: true,
  },
  {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'wSOL',
    name: 'Wrapped SOL',
    decimals: 9,
    program: 'spl-token',
    stable: false,
  },
];

const DEVNET: ReadonlyArray<KnownToken> = [
  {
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    symbol: 'USDC',
    name: 'USD Coin (devnet)',
    decimals: 6,
    program: 'spl-token',
    stable: true,
  },
  {
    mint: 'EcFc2cMyZxaKBkFK1XooxiyDyCPneLXiMwSJiVY6eTad',
    symbol: 'USDT',
    name: 'Tether USD (devnet)',
    decimals: 6,
    program: 'spl-token',
    stable: true,
  },
  {
    mint: '4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7',
    symbol: 'USDG',
    name: 'Global Dollar (devnet)',
    decimals: 6,
    program: 'spl-token-2022',
    stable: true,
  },
  {
    mint: 'So11111111111111111111111111111111111111112',
    symbol: 'wSOL',
    name: 'Wrapped SOL (devnet)',
    decimals: 9,
    program: 'spl-token',
    stable: false,
  },
];

export const KNOWN_TOKENS: Record<TokenNetwork, ReadonlyArray<KnownToken>> = {
  mainnet: MAINNET,
  devnet: DEVNET,
};

/** Look up a known token by mint address on a given network. */
export function lookupToken(mint: string, network: TokenNetwork): KnownToken | undefined {
  return KNOWN_TOKENS[network].find((t) => t.mint === mint);
}

/**
 * Symbols of the well-known USD-pegged stablecoins Leash supports for x402
 * settlement. Restricted to the registry's stable entries so consumers can
 * pin a typed dropdown without re-deriving the list.
 */
export type KnownStableSymbol = 'USDC' | 'USDT' | 'USDG';

/** All stablecoin tickers we recognise on at least one network. */
export const KNOWN_STABLE_SYMBOLS: ReadonlyArray<KnownStableSymbol> = ['USDC', 'USDT', 'USDG'];

/**
 * Look up a known token by ticker symbol (case-insensitive) on a given
 * network. Useful for translating a user-facing currency dropdown into the
 * underlying mint address required by x402 `AssetAmount` prices.
 */
export function lookupTokenBySymbol(symbol: string, network: TokenNetwork): KnownToken | undefined {
  const upper = symbol.trim().toUpperCase();
  return KNOWN_TOKENS[network].find((t) => t.symbol.toUpperCase() === upper);
}

/**
 * Reverse-lookup a currency ticker for an asset mint. Falls back to `'USDC'`
 * (the v0.1 default settlement currency) when the mint is unknown — buyer
 * receipts surface a usable label even if the seller advertises a token the
 * Leash registry hasn't catalogued yet.
 */
export function currencyForAsset(asset: string | null | undefined, network: TokenNetwork): string {
  if (!asset) return 'USDC';
  return lookupToken(asset, network)?.symbol ?? 'USDC';
}

/**
 * Mints we always want to render in a treasury UI even when the agent
 * holds zero — the headline stables. Other tokens only appear once the
 * agent actually holds a balance.
 */
export function pinnedMints(network: TokenNetwork): string[] {
  return KNOWN_TOKENS[network].filter((t) => t.stable).map((t) => t.mint);
}

/**
 * Heuristic mapping of an RPC URL to a logical network bucket. Treats
 * anything containing `devnet`, `localhost`, or a private-network IP as
 * devnet; everything else as mainnet.
 */
export function networkFromRpc(rpc: string): TokenNetwork {
  return /devnet|localhost|127\.0\.0\.1/.test(rpc) ? 'devnet' : 'mainnet';
}

/**
 * Resolve the canonical USDC mint for the given network. Used by buyer-kit
 * pre-flight checks ("does the treasury have enough?") and by UI to seed
 * default token selectors.
 */
export function defaultUsdcMint(network: TokenNetwork): KnownToken {
  const usdc = KNOWN_TOKENS[network].find((t) => t.symbol === 'USDC');
  if (!usdc) {
    throw new Error(`No USDC mint registered for network "${network}"`);
  }
  return usdc;
}
