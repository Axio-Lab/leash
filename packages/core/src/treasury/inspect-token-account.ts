/**
 * Read the live state of a single SPL token account (legacy SPL or
 * Token-2022) over JSON-RPC and surface the bits Leash cares about for
 * pre-flight diagnostics: holdings (`amount`), the SPL **delegate**, and the
 * outstanding **delegated allowance**.
 *
 * The raw on-chain layout is parsed by the RPC's `jsonParsed` encoder, so we
 * never have to ship a base58 / Borsh decoder here. Returns `null` when the
 * account does not exist (uninitialised ATA) so callers can distinguish
 * "truly empty" from "missing".
 *
 * Used by `@leashmarket/buyer-kit` to reclassify a generic facilitator
 * `transaction_simulation` failure into a precise
 * `insufficient_balance` / `insufficient_allowance` / `no_delegate`
 * verdict on the resulting receipt.
 */

export type SplTokenAccountState = {
  /** The token account address that was inspected. */
  address: string;
  /** SPL mint this account holds. */
  mint: string;
  /** On-chain owner of the token account (treasury PDA, wallet, etc.). */
  owner: string;
  /** Holdings in atomic units (e.g. `5_000_000n` for 5 USDC at 6 decimals). */
  amount: bigint;
  /** SPL token decimals as reported by the RPC's parsed encoding. */
  decimals: number;
  /** SPL delegate address (the authority approved to spend), or `null`. */
  delegate: string | null;
  /** Outstanding allowance in atomic units. `0n` when no delegate is set. */
  delegatedAmount: bigint;
  /** Which token program owns this account (matters for instruction encoding). */
  program: 'spl-token' | 'spl-token-2022' | 'unknown';
};

export type InspectSplTokenAccountOptions = {
  rpcUrl: string;
  /** The token account address (an ATA, typically). */
  address: string;
};

type ParsedAccount = {
  pubkey?: string;
  owner: string;
  data: {
    parsed: {
      type: string;
      info: {
        mint: string;
        owner: string;
        tokenAmount: { amount: string; decimals: number };
        delegate?: string;
        delegatedAmount?: { amount: string; decimals: number };
      };
    };
    program: string;
  };
};

/**
 * Returns the parsed state of `address` or `null` if the account does not
 * exist on-chain. Throws on RPC transport errors (so callers can decide
 * whether to surface a degraded-mode warning vs. fail open).
 */
export async function inspectSplTokenAccount(
  opts: InspectSplTokenAccountOptions,
): Promise<SplTokenAccountState | null> {
  const result = await rpc<{ value: ParsedAccount | null }>(opts.rpcUrl, 'getAccountInfo', [
    opts.address,
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);
  if (!result.value) return null;
  const parsed = result.value.data.parsed;
  // Only token accounts have `parsed.type === 'account'`. Anything else
  // (mint accounts, plain wallets, etc.) is not what callers asked for.
  if (parsed.type !== 'account') return null;
  const info = parsed.info;
  const programLabel: SplTokenAccountState['program'] =
    result.value.data.program === 'spl-token'
      ? 'spl-token'
      : result.value.data.program === 'spl-token-2022'
        ? 'spl-token-2022'
        : 'unknown';
  return {
    address: opts.address,
    mint: info.mint,
    owner: info.owner,
    amount: BigInt(info.tokenAmount.amount),
    decimals: info.tokenAmount.decimals,
    delegate: info.delegate ?? null,
    delegatedAmount: info.delegatedAmount ? BigInt(info.delegatedAmount.amount) : 0n,
    program: programLabel,
  };
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
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
