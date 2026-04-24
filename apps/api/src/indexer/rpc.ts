/**
 * Tiny Solana JSON-RPC client used by the indexer.
 *
 * We intentionally avoid pulling in `@solana/web3.js` here — it brings a
 * lot of weight, the indexer only needs three calls
 * (`getSignaturesForAddress`, `getTransaction`, `getSlot`), and we
 * benefit from being able to stub the wire format directly in tests via
 * a `fetch` injection.
 *
 * The client is request-scoped: callers pass an RPC URL per call. Two
 * networks => two URLs; we never want to accidentally cross them.
 */

export type RpcSignature = {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
};

export type ParsedTxLog = string;

export type RpcParsedTransaction = {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  logs: ParsedTxLog[];
  /**
   * Program IDs touched by the transaction, in order of first appearance.
   * Lets the decoder bail early when none of our known program IDs are
   * present (e.g. an unrelated SOL transfer landed on the watched address).
   */
  programIds: string[];
  /**
   * Account keys involved in the transaction (account index -> base58
   * pubkey). We expose just the keys we need; we don't try to model the
   * full instruction tree here.
   */
  accountKeys: string[];
  /**
   * Net token-balance deltas keyed by `${owner}|${mint}`. Used to detect
   * treasury withdraw amounts without parsing instruction data.
   */
  tokenBalanceDeltas: Array<{
    owner: string;
    mint: string;
    /** atomic difference (`postAmount - preAmount`) as a base-10 string */
    delta: string;
  }>;
  /**
   * Lamport balance deltas keyed by account index. Used to detect SOL
   * withdrawals (treasury PDA going down).
   */
  lamportDeltas: Array<{ pubkey: string; delta: string }>;
};

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }>;

export type RpcClient = {
  /**
   * Returns the most recent `before -> until` window of signatures
   * touching `address`, newest first (per Solana RPC contract).
   */
  getSignaturesForAddress(args: {
    network: string;
    address: string;
    before?: string | null;
    until?: string | null;
    limit?: number;
  }): Promise<RpcSignature[]>;

  /**
   * Fetches a parsed transaction by signature. Returns `null` when the
   * tx is not found (e.g. dropped, or only available on a different
   * cluster).
   */
  getTransaction(args: {
    network: string;
    signature: string;
  }): Promise<RpcParsedTransaction | null>;
};

export type RpcDeps = {
  rpcUrls: Record<string, string>;
  fetch?: FetchLike;
};

export function createRpcClient(deps: RpcDeps): RpcClient {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  if (!fetchImpl) throw new Error('createRpcClient: no fetch implementation available');

  async function call<T>(network: string, method: string, params: unknown[]): Promise<T> {
    const url = deps.rpcUrls[network];
    if (!url) throw new Error(`indexer rpc: no url configured for network=${network}`);
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`rpc ${method} failed (${res.status}): ${text.slice(0, 256)}`);
    }
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) {
      throw new Error(`rpc ${method} error ${body.error.code}: ${body.error.message}`);
    }
    if (body.result === undefined) {
      throw new Error(`rpc ${method} returned no result`);
    }
    return body.result;
  }

  return {
    async getSignaturesForAddress(args) {
      const params: unknown[] = [
        args.address,
        {
          limit: Math.min(Math.max(args.limit ?? 100, 1), 1000),
          ...(args.before ? { before: args.before } : {}),
          ...(args.until ? { until: args.until } : {}),
          commitment: 'confirmed',
        },
      ];
      type RawSig = {
        signature: string;
        slot: number;
        blockTime: number | null;
        err: unknown;
      };
      const raw = await call<RawSig[]>(args.network, 'getSignaturesForAddress', params);
      return raw.map((s) => ({
        signature: s.signature,
        slot: s.slot,
        blockTime: s.blockTime,
        err: s.err,
      }));
    },

    async getTransaction(args) {
      const params: unknown[] = [
        args.signature,
        {
          encoding: 'json',
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        },
      ];
      type RawTx = {
        slot: number;
        blockTime: number | null;
        meta: {
          err: unknown;
          logMessages?: string[];
          preTokenBalances?: Array<{
            accountIndex: number;
            mint: string;
            owner?: string;
            uiTokenAmount: { amount: string };
          }>;
          postTokenBalances?: Array<{
            accountIndex: number;
            mint: string;
            owner?: string;
            uiTokenAmount: { amount: string };
          }>;
          preBalances: number[];
          postBalances: number[];
        };
        transaction: {
          message: {
            accountKeys: string[];
            instructions: Array<{ programIdIndex: number }>;
          };
        };
      };
      const raw = await call<RawTx | null>(args.network, 'getTransaction', params);
      if (!raw) return null;
      const accountKeys = raw.transaction.message.accountKeys;
      const programIds = Array.from(
        new Set(raw.transaction.message.instructions.map((i) => accountKeys[i.programIdIndex]!)),
      );
      const tokenBalanceDeltas = computeTokenDeltas(
        raw.meta.preTokenBalances ?? [],
        raw.meta.postTokenBalances ?? [],
        accountKeys,
      );
      const lamportDeltas = raw.meta.preBalances.map((pre, i) => ({
        pubkey: accountKeys[i]!,
        delta: (BigInt(raw.meta.postBalances[i]!) - BigInt(pre)).toString(),
      }));
      return {
        signature: args.signature,
        slot: raw.slot,
        blockTime: raw.blockTime,
        err: raw.meta.err,
        logs: raw.meta.logMessages ?? [],
        programIds,
        accountKeys,
        tokenBalanceDeltas,
        lamportDeltas,
      };
    },
  };
}

type RawTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
};

function computeTokenDeltas(
  pre: RawTokenBalance[],
  post: RawTokenBalance[],
  accountKeys: string[],
): Array<{ owner: string; mint: string; delta: string }> {
  const keyOf = (b: RawTokenBalance) => `${b.owner ?? accountKeys[b.accountIndex]!}|${b.mint}`;
  const preMap = new Map(pre.map((b) => [keyOf(b), BigInt(b.uiTokenAmount.amount)]));
  const postMap = new Map(post.map((b) => [keyOf(b), BigInt(b.uiTokenAmount.amount)]));
  const out: Array<{ owner: string; mint: string; delta: string }> = [];
  const allKeys = new Set([...preMap.keys(), ...postMap.keys()]);
  for (const k of allKeys) {
    const before = preMap.get(k) ?? 0n;
    const after = postMap.get(k) ?? 0n;
    if (before === after) continue;
    const sep = k.lastIndexOf('|');
    out.push({
      owner: k.slice(0, sep),
      mint: k.slice(sep + 1),
      delta: (after - before).toString(),
    });
  }
  return out;
}
