/**
 * Treasury ATA discovery.
 *
 * The indexer needs to watch every ATA owned by a treasury PDA so that
 * plain SPL `TransferChecked` deposits (which don't include the PDA in
 * their account list) are surfaced through `getSignaturesForAddress`.
 *
 * Rather than register every ATA upfront in the API (which we also do,
 * lazily, from the provision/balances/withdraw paths), the indexer can
 * self-bootstrap by asking the RPC for every SPL token account the
 * treasury currently owns. Two RPC calls per agent — one for the
 * classic SPL Token program, one for Token-2022 — give us the full
 * picture in a single round trip and let the indexer recover even if
 * an agent was provisioned out-of-band (e.g. directly via the SDK
 * without ever touching the API's prepare endpoints).
 *
 * Called at most once per agent per indexer process — the result is
 * cached in `discoveredAgents` in `run.ts`. New ATAs created mid-run
 * are picked up by the API's prepare hooks; restarting the indexer
 * triggers a fresh sweep.
 */

const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export type TreasuryAta = string;

/**
 * Return every SPL token account pubkey owned by `treasuryAddress`,
 * across both the classic SPL Token and Token-2022 programs.
 *
 * `fetchImpl` is injected so tests can stub the RPC; production passes
 * `globalThis.fetch`.
 */
export async function discoverTreasuryAtas(args: {
  rpcUrl: string;
  treasuryAddress: string;
  fetchImpl?: typeof fetch;
}): Promise<TreasuryAta[]> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('discoverTreasuryAtas: no fetch implementation available');

  const out: string[] = [];
  for (const programId of [SPL_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const accounts = await getTokenAccountsByOwner({
      fetchImpl,
      rpcUrl: args.rpcUrl,
      owner: args.treasuryAddress,
      programId,
    });
    for (const a of accounts) out.push(a);
  }
  // De-dup just in case (defensive — programIds are disjoint, but
  // mistyped RPCs have been seen to merge them).
  return Array.from(new Set(out));
}

async function getTokenAccountsByOwner(args: {
  fetchImpl: typeof fetch;
  rpcUrl: string;
  owner: string;
  programId: string;
}): Promise<string[]> {
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'getTokenAccountsByOwner',
    params: [
      args.owner,
      { programId: args.programId },
      { encoding: 'base64', commitment: 'confirmed' },
    ],
  };
  const res = await args.fetchImpl(args.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getTokenAccountsByOwner failed (${res.status}): ${text.slice(0, 256)}`);
  }
  type Resp = {
    result?: { value?: Array<{ pubkey: string }> };
    error?: { message: string };
  };
  const json = (await res.json()) as Resp;
  if (json.error) throw new Error(`rpc error: ${json.error.message}`);
  return (json.result?.value ?? []).map((v) => v.pubkey);
}
