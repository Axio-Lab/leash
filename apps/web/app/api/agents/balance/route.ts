import { NextResponse } from 'next/server';
import { getAgentTreasury } from '@leash/registry-utils';
import { asPublicKey, getReadOnlyUmi } from '@/lib/umi';
import { lookupToken, networkFromRpc, pinnedMints, type KnownToken } from '@/lib/known-tokens';
import { SOLANA_RPC } from '@/lib/env';

export const runtime = 'nodejs';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

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

type TokenBalance = {
  mint: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
  amount: string;
  ui: number;
  program: 'spl-token' | 'spl-token-2022';
  known: boolean;
};

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${method}: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`RPC ${method}: empty result`);
  return json.result;
}

async function fetchTokensForProgram(
  owner: string,
  programId: string,
  programLabel: 'spl-token' | 'spl-token-2022',
): Promise<TokenBalance[]> {
  const result = await rpc<{ value: RpcParsedTokenAccount[] }>('getTokenAccountsByOwner', [
    owner,
    { programId },
    { encoding: 'jsonParsed' },
  ]);
  const network = networkFromRpc(SOLANA_RPC);
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

function emptyBalance(mint: string, meta: KnownToken): TokenBalance {
  return {
    mint,
    symbol: meta.symbol,
    name: meta.name,
    decimals: meta.decimals,
    amount: '0',
    ui: 0,
    program: meta.program ?? 'spl-token',
    known: true,
  };
}

/**
 * GET /api/agents/balance?asset=<mint>
 * Returns the SOL balance plus all SPL token balances (Token + Token-2022)
 * held by the agent's Asset Signer PDA. Stables (USDC/USDT/USDG) are pinned
 * with zero balance when the agent doesn't hold them yet, so the UI can
 * always render them.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const asset = url.searchParams.get('asset');
  if (!asset) {
    return NextResponse.json({ error: 'missing_asset' }, { status: 400 });
  }

  try {
    const umi = getReadOnlyUmi();
    const treasury = getAgentTreasury(umi, asset);
    const network = networkFromRpc(SOLANA_RPC);

    const [solBalance, splTokens, spl22Tokens] = await Promise.all([
      umi.rpc.getBalance(asPublicKey(treasury)),
      fetchTokensForProgram(treasury, TOKEN_PROGRAM_ID, 'spl-token').catch(() => []),
      fetchTokensForProgram(treasury, TOKEN_2022_PROGRAM_ID, 'spl-token-2022').catch(() => []),
    ]);

    const held = [...splTokens, ...spl22Tokens];
    const heldByMint = new Map(held.map((t) => [t.mint, t]));

    for (const mint of pinnedMints(network)) {
      if (!heldByMint.has(mint)) {
        const meta = lookupToken(mint, network);
        if (meta) heldByMint.set(mint, emptyBalance(mint, meta));
      }
    }

    const tokens = [...heldByMint.values()].sort((a, b) => {
      if (a.known !== b.known) return a.known ? -1 : 1;
      if (a.ui !== b.ui) return b.ui - a.ui;
      return (a.symbol ?? a.mint).localeCompare(b.symbol ?? b.mint);
    });

    return NextResponse.json({
      asset,
      treasury,
      network,
      sol: Number(solBalance.basisPoints) / 1_000_000_000,
      lamports: solBalance.basisPoints.toString(),
      tokens,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'balance_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
