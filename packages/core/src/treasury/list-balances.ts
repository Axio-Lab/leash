/**
 * Enumerate every SPL token an owner holds (legacy SPL + Token-2022),
 * enrich with metadata from the {@link KNOWN_TOKENS} registry, and pin
 * stablecoin entries with zero balance when missing so UI surfaces always
 * render them.
 *
 * This consolidates logic that previously lived in
 * `apps/web/app/api/agents/balance/route.ts` and
 * `apps/web/app/api/wallet/balance/route.ts`. Calling it from the SDK means
 * any future Leash surface (CLI, mobile, downstream agents) gets the same
 * canonical balance shape without re-implementing the RPC plumbing.
 */

import {
  KNOWN_TOKENS,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  lookupToken,
  pinnedMints,
  type KnownToken,
  type TokenNetwork,
} from '../tokens/index.js';

export type SplTokenBalance = {
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  /** Atomic integer string (e.g. `"1500000"` for 1.5 USDC). */
  amount: string;
  /** UI decimal as a number — best-effort, lossy for very large amounts. */
  ui: number;
  program: 'spl-token' | 'spl-token-2022';
  /** True when the mint is in {@link KNOWN_TOKENS} for the requested network. */
  known: boolean;
};

export type ListSplBalancesOptions = {
  /** Owner address (a wallet, an agent treasury PDA, etc.). */
  owner: string;
  /** Solana RPC endpoint to query. */
  rpcUrl: string;
  /** Logical network bucket — controls which mints get pinned. */
  network: TokenNetwork;
  /**
   * If true, include stable-coin mints from {@link KNOWN_TOKENS} with zero
   * balance when the owner doesn't hold them. Defaults to `true`. Disable
   * for callers that want a strict on-chain view (e.g. analytics).
   */
  pinKnownStables?: boolean;
};

export type ListSplBalancesResult = {
  owner: string;
  network: TokenNetwork;
  /** SOL balance as decimal (lossy for large balances; see `lamports`). */
  sol: number;
  /** Raw lamport count as a string (lossless). */
  lamports: string;
  tokens: SplTokenBalance[];
};

/**
 * Enumerate balances. Tolerates RPC failures on either token program — if
 * Token-2022 calls fail (some RPCs lag here), the function still returns
 * legacy SPL balances rather than throwing.
 */
export async function listSplBalances(
  opts: ListSplBalancesOptions,
): Promise<ListSplBalancesResult> {
  const pin = opts.pinKnownStables ?? true;
  const [lamports, splTokens, spl22Tokens] = await Promise.all([
    fetchLamports(opts.rpcUrl, opts.owner),
    fetchTokensForProgram(
      opts.rpcUrl,
      opts.owner,
      TOKEN_PROGRAM_ID,
      'spl-token',
      opts.network,
    ).catch(() => []),
    fetchTokensForProgram(
      opts.rpcUrl,
      opts.owner,
      TOKEN_2022_PROGRAM_ID,
      'spl-token-2022',
      opts.network,
    ).catch(() => []),
  ]);

  const held = [...splTokens, ...spl22Tokens];
  const heldByMint = new Map(held.map((t) => [t.mint, t]));

  if (pin) {
    for (const mint of pinnedMints(opts.network)) {
      if (!heldByMint.has(mint)) {
        const meta = lookupToken(mint, opts.network);
        if (meta) heldByMint.set(mint, emptyBalance(meta));
      }
    }
  }

  const tokens = [...heldByMint.values()].sort((a, b) => {
    if (a.known !== b.known) return a.known ? -1 : 1;
    if (a.ui !== b.ui) return b.ui - a.ui;
    return (a.symbol ?? a.mint).localeCompare(b.symbol ?? b.mint);
  });

  return {
    owner: opts.owner,
    network: opts.network,
    sol: Number(lamports) / 1_000_000_000,
    lamports: lamports.toString(),
    tokens,
  };
}

type RpcParsedTokenAccount = {
  pubkey: string;
  account: {
    data: {
      parsed: {
        info: {
          mint: string;
          tokenAmount: { amount: string; decimals: number; uiAmount: number | null };
        };
      };
    };
  };
};

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  // `cache: 'no-store'` is a browser/Next.js RequestInit extension; we cast
  // to keep the SDK consumable from server-only code (Node 20+) without
  // pulling in DOM lib types.
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  } as RequestInit & { cache?: string });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`RPC ${method}: empty result`);
  return json.result;
}

async function fetchLamports(rpcUrl: string, owner: string): Promise<bigint> {
  const result = await rpc<{ value: number }>(rpcUrl, 'getBalance', [
    owner,
    { commitment: 'confirmed' },
  ]);
  return BigInt(result.value);
}

async function fetchTokensForProgram(
  rpcUrl: string,
  owner: string,
  programId: string,
  programLabel: 'spl-token' | 'spl-token-2022',
  network: TokenNetwork,
): Promise<SplTokenBalance[]> {
  const result = await rpc<{ value: RpcParsedTokenAccount[] }>(rpcUrl, 'getTokenAccountsByOwner', [
    owner,
    { programId },
    { encoding: 'jsonParsed' },
  ]);
  return result.value.map((acc) => {
    const info = acc.account.data.parsed.info;
    const known = lookupToken(info.mint, network);
    return {
      mint: info.mint,
      symbol: known?.symbol ?? null,
      name: known?.name ?? null,
      decimals: info.tokenAmount.decimals,
      amount: info.tokenAmount.amount,
      ui:
        info.tokenAmount.uiAmount ??
        Number(info.tokenAmount.amount) / 10 ** info.tokenAmount.decimals,
      program: programLabel,
      known: !!known,
    };
  });
}

function emptyBalance(meta: KnownToken): SplTokenBalance {
  return {
    mint: meta.mint,
    symbol: meta.symbol,
    name: meta.name,
    decimals: meta.decimals,
    amount: '0',
    ui: 0,
    program: meta.program,
    known: true,
  };
}

// Re-export for convenience so consumers don't import a parallel symbol from
// '../tokens/index.js' just to render labels.
export { KNOWN_TOKENS };
