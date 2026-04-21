/**
 * Static registry of well-known SPL token mints used to enrich the agent
 * treasury display. Only contains stables and a couple of bluechips — full
 * registry resolution (Token-2022 metadata, Jupiter token list, etc.) is
 * out of scope for the playground. New entries should include both the
 * mainnet and devnet mint where one exists; devnet stables are usually
 * faucet-mintable test versions, not the same authority as mainnet.
 */
export type Network = 'mainnet' | 'devnet';

export type KnownToken = {
  symbol: string;
  name: string;
  decimals: number;
  /** TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', Token-2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb' */
  program?: 'spl-token' | 'spl-token-2022';
};

const REGISTRY: Record<Network, Record<string, KnownToken>> = {
  mainnet: {
    EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
    },
    Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
      symbol: 'USDT',
      name: 'Tether USD',
      decimals: 6,
    },
    // Global Dollar (USDG) — Paxos, Token-2022.
    '2u1tszSeqZ3qBWF3uNGPFc8TzMk2tdiwknnRMWGWjGWH': {
      symbol: 'USDG',
      name: 'Global Dollar',
      decimals: 6,
      program: 'spl-token-2022',
    },
    DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: {
      symbol: 'BONK',
      name: 'Bonk',
      decimals: 5,
    },
    So11111111111111111111111111111111111111112: {
      symbol: 'wSOL',
      name: 'Wrapped SOL',
      decimals: 9,
    },
    JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: {
      symbol: 'JUP',
      name: 'Jupiter',
      decimals: 6,
    },
  },
  devnet: {
    // Circle's official devnet USDC.
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': {
      symbol: 'USDC',
      name: 'USD Coin (devnet)',
      decimals: 6,
    },
    // Common community-issued devnet USDT used by faucets.
    '7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3': {
      symbol: 'USDT',
      name: 'Tether USD (devnet)',
      decimals: 6,
    },
    So11111111111111111111111111111111111111112: {
      symbol: 'wSOL',
      name: 'Wrapped SOL (devnet)',
      decimals: 9,
    },
  },
};

export function networkFromRpc(rpc: string): Network {
  return /devnet|localhost|127\.0\.0\.1/.test(rpc) ? 'devnet' : 'mainnet';
}

export function lookupToken(mint: string, network: Network): KnownToken | undefined {
  return REGISTRY[network][mint];
}

/** Mints we always want to show, even when the treasury holds zero. */
export function pinnedMints(network: Network): string[] {
  return Object.keys(REGISTRY[network]).filter((mint) => {
    const t = REGISTRY[network][mint];
    return t.symbol === 'USDC' || t.symbol === 'USDT' || t.symbol === 'USDG';
  });
}
