'use client';

/**
 * Withdraw request card.
 *
 * Server-side `leash_withdraw_treasury` cannot settle on its own —
 * `mpl-core::Execute` requires the asset owner (the connected Privy
 * wallet) to sign, and that key never leaves the browser. The MCP
 * tool just validates inputs and returns a `withdraw_request`
 * artifact this component renders, including:
 *
 *   1. A summary of what will move (token, amount, destination, network).
 *   2. A single "Approve & withdraw" button that calls
 *      `withdrawTreasury` / `withdrawTreasurySol` from
 *      `@leash/registry-utils` using the same `usePrivyUmi` flow that
 *      already powers /profile/agent → Treasury panel.
 *   3. Inline confirmation (tx sig + Solscan link) on success, with
 *      `markWithdrawCompleted` stamping the artifact so a refresh
 *      doesn't revert to the prompt.
 *
 * Same architectural pattern as `pay-request-artifact.tsx` — only the
 * inner instruction differs (TransferChecked / SystemTransfer instead
 * of x402's buyer-kit fetch).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';
import { publicKey } from '@metaplex-foundation/umi';
import { AlertTriangleIcon, Check, Loader2 } from 'lucide-react';
import { TOKEN_2022_PROGRAM_ID } from '@leash/core';
import { withdrawTreasury, withdrawTreasurySol } from '@leash/registry-utils';

import { Button } from '@/components/ui/button';
import { shortHash, solscanAccountUrl, solscanTxUrl } from '@/lib/explorer';
import { SOLANA_NETWORK } from '@/lib/env';
import { usePrivyUmi } from '@/lib/use-privy-umi';
import { formatChainError } from '@/lib/format-chain-error';
import { markWithdrawCompleted } from '@/lib/chat-storage';

export type WithdrawRequestPayload = {
  agent_mint?: string;
  /** Symbol the user typed: SOL | USDC | USDG | USDT. */
  token?: string;
  /** SPL mint address — null for native SOL. */
  mint?: string | null;
  /** Token program owning the mint (only set for Token-2022). */
  token_program?: string | null;
  decimals?: number;
  /** Whole-unit amount string ("100" for 100 USDC, "0.5" for 0.5 SOL). */
  amount?: string;
  /** Atomic amount string — server pre-computed from amount × 10^decimals. */
  amount_atomic?: string;
  destination?: string;
  network?: string;
  /**
   * Stamped after a successful withdrawal so the card hydrates to
   * "Withdraw confirmed" on page refresh.
   */
  completed_tx_sig?: string;
};

type FlowState =
  | { kind: 'idle' }
  | { kind: 'signing' }
  | { kind: 'done'; txSig: string }
  | { kind: 'failed'; reason: string };

type BalancesResponse = {
  sol: number;
  tokens: Array<{ symbol: string | null; mint: string; ui: number; decimals: number }>;
};

const balancesFetcher = async (url: string): Promise<BalancesResponse | null> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return null;
  return res.json();
};

/**
 * Heuristic check for whether `destination` is a "first-time" wallet
 * the user should sanity-check before signing. We treat:
 *   - non-existent System account            → fresh
 *   - existing System account with 0 lamports → fresh
 * Both are common for a fat-finger / typo address (the user transposed
 * a digit and typed a never-funded pubkey).
 *
 * This is heuristic — a real "first time you've sent here" feature
 * would require server-side history, but for a fat-finger guard
 * checking the destination has any on-chain footprint at all is a
 * very effective signal at zero infrastructure cost.
 */
type DestProbe = { state: 'fresh' | 'known' | 'unknown' };

export function WithdrawRequestArtifact({
  payload,
  threadId,
}: {
  payload: WithdrawRequestPayload;
  threadId?: string;
}) {
  const { umi, ready } = usePrivyUmi();
  const { user } = usePrivy();

  const token = (payload.token ?? '').toUpperCase();
  const decimals = payload.decimals ?? (token === 'SOL' ? 9 : 6);
  const amount = payload.amount ?? '';
  const destination = payload.destination ?? '';
  const agentMint = payload.agent_mint ?? '';
  const network = payload.network ?? SOLANA_NETWORK;

  // Live treasury balance — surfaces "Available: X TOKEN" above the
  // Approve button so the user can sanity-check they have enough
  // before signing. SWR cache is shared with /profile/agent so this
  // is usually warm.
  const { data: balances } = useSWR<BalancesResponse | null>(
    agentMint ? `/api/agents/${encodeURIComponent(agentMint)}/balances` : null,
    balancesFetcher,
    { revalidateOnFocus: false, dedupingInterval: 15_000 },
  );

  const available = useMemo<number | null>(() => {
    if (!balances) return null;
    if (token === 'SOL') return balances.sol;
    const t = balances.tokens.find((b) => (b.symbol ?? '').toUpperCase() === token);
    return t?.ui ?? 0;
  }, [balances, token]);

  const numericAmount = useMemo(() => Number.parseFloat(amount), [amount]);
  const insufficient =
    available !== null && Number.isFinite(numericAmount) && numericAmount > available + 1e-9;

  // Probe destination on mount — single getAccount RPC; cheap and
  // deduped by Privy umi's connection. We confirm in two ways:
  // a "fresh" account warning before signing, plus a Solscan link
  // so the user can verify the address themselves.
  const [destProbe, setDestProbe] = useState<DestProbe>({ state: 'unknown' });
  useEffect(() => {
    let cancelled = false;
    if (!umi || !destination) return;
    void (async () => {
      try {
        const acct = await umi.rpc.getAccount(publicKey(destination));
        if (cancelled) return;
        const lamports = acct.exists ? Number(acct.lamports.basisPoints) : 0;
        setDestProbe({ state: !acct.exists || lamports === 0 ? 'fresh' : 'known' });
      } catch {
        if (!cancelled) setDestProbe({ state: 'unknown' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [umi, destination]);

  // Hydrate from persisted artifact state — the same pattern Pay uses
  // so refresh lands directly on "Withdraw confirmed".
  const [state, setState] = useState<FlowState>(() => {
    if (payload.completed_tx_sig) {
      return { kind: 'done', txSig: payload.completed_tx_sig };
    }
    return { kind: 'idle' };
  });

  const niceNetwork = useMemo(() => prettyNet(network), [network]);

  async function approveAndWithdraw() {
    if (!agentMint) {
      toast.error('No agent on file', {
        description: 'Mint one under Profile → Agent first.',
      });
      return;
    }
    if (!umi || !ready) {
      toast.error('Wallet not ready', {
        description: 'Connect your Privy wallet so the owner can sign.',
      });
      return;
    }
    if (!destination) {
      toast.error('Withdraw card missing destination address.');
      return;
    }
    if (!amount || Number(amount) <= 0) {
      toast.error('Withdraw card has an invalid amount.');
      return;
    }
    setState({ kind: 'signing' });
    try {
      let txSig: string;
      if (token === 'SOL') {
        const lamports = BigInt(payload.amount_atomic ?? '0');
        if (lamports <= 0n) throw new Error('amount rounds to zero lamports');
        const res = await withdrawTreasurySol(umi, {
          agentAsset: agentMint,
          destination,
          lamports,
        });
        txSig = res.signature;
      } else {
        if (!payload.mint) throw new Error('withdraw card is missing the SPL mint');
        const atomic = BigInt(
          payload.amount_atomic ?? Math.floor(Number(amount) * 10 ** decimals).toString(),
        );
        if (atomic <= 0n) throw new Error('amount rounds to zero atomic units');
        // Resolve the SPL token program in this priority:
        //   1. Explicit `token_program` from the server payload (set
        //      whenever the mint is Token-2022, e.g. USDG).
        //   2. Symbol-based fallback for USDG when the server forgot.
        //   3. Default to classic SPL Token via `withdrawTreasury`'s
        //      built-in fallback (no `tokenProgram` arg passed).
        const tokenProgram = payload.token_program
          ? publicKey(payload.token_program)
          : token === 'USDG'
            ? publicKey(TOKEN_2022_PROGRAM_ID)
            : undefined;
        const res = await withdrawTreasury(umi, {
          agentAsset: agentMint,
          mint: payload.mint,
          destination,
          amount: atomic,
          decimals,
          ...(tokenProgram ? { tokenProgram } : {}),
        });
        txSig = res.signature;
      }
      setState({ kind: 'done', txSig });
      try {
        if (user?.id && threadId) {
          markWithdrawCompleted(
            user.id,
            threadId,
            { token, amount, destination },
            { tx_sig: txSig },
          );
          payload.completed_tx_sig = txSig;
        }
      } catch {
        // Persistence is best-effort; the on-chain tx already
        // succeeded, so don't surface storage errors as failures.
      }
      toast.success('Withdraw confirmed', { description: `Tx ${shortHash(txSig)}` });
    } catch (err) {
      const reason = formatChainError(err);
      setState({ kind: 'failed', reason });
      toast.error('Withdraw failed', { description: reason });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-elev p-3 text-sm space-y-3">
      <div className="space-y-0.5">
        <div className="text-xs font-medium text-fg-muted">Withdraw request</div>
        <div className="text-fg font-medium">
          {amount} {token}
          {destination ? (
            <span className="ml-2 text-fg-muted font-normal">
              → <span className="font-mono text-[11px]">{shortAddr(destination)}</span>
            </span>
          ) : null}
        </div>
        {niceNetwork ? <div className="text-xs text-fg-muted">{niceNetwork}</div> : null}
      </div>

      {destination ? (
        <div className="rounded-md border border-border/60 bg-bg/40 p-2 space-y-1">
          <div className="font-mono text-[11px] break-all text-fg-muted">{destination}</div>
          <div className="flex items-center justify-between gap-2 text-[10px] text-fg-subtle">
            {available !== null ? (
              <span>
                Available:{' '}
                <span className={`font-mono ${insufficient ? 'text-warning' : 'text-fg-muted'}`}>
                  {fmtAvailable(available)} {token}
                </span>
              </span>
            ) : (
              <span className="opacity-60">Available: …</span>
            )}
            <Link
              href={solscanAccountUrl(destination, network)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline whitespace-nowrap"
            >
              Verify on Solscan ↗
            </Link>
          </div>
        </div>
      ) : null}

      {/* Soft warning for fresh / never-funded destination addresses.
          Doesn't block the user — typos are common, but legitimate
          first-payments are also common. The user can still sign. */}
      {state.kind !== 'done' && destProbe.state === 'fresh' && destination ? (
        <div className="rounded-md border border-warning/40 bg-warning/8 px-2 py-1.5 flex items-start gap-2 text-[11px] text-warning leading-snug">
          <AlertTriangleIcon className="size-3.5 shrink-0 mt-0.5" />
          <span>
            First-time destination — this address has no on-chain history. Double-check it before
            signing; typos can't be reversed.
          </span>
        </div>
      ) : null}

      {state.kind !== 'done' && insufficient ? (
        <div className="rounded-md border border-danger/40 bg-danger/8 px-2 py-1.5 text-[11px] text-danger leading-snug">
          Insufficient {token} in treasury. Available {fmtAvailable(available ?? 0)} {token}; the
          card asks for {amount} {token}.
        </div>
      ) : null}

      {state.kind === 'done' ? (
        <DoneReceipt txSig={state.txSig} network={network} />
      ) : (
        <div className="flex items-center gap-1.5 pt-0.5">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={approveAndWithdraw}
            disabled={state.kind === 'signing' || !ready || !umi || insufficient}
            className="h-7 px-2 text-xs"
          >
            {state.kind === 'signing' ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                Signing…
              </>
            ) : (
              <>Approve &amp; withdraw</>
            )}
          </Button>
        </div>
      )}

      {state.kind === 'failed' ? (
        <div className="text-xs text-danger break-words">Failed: {state.reason}</div>
      ) : null}
    </div>
  );
}

function DoneReceipt({ txSig, network }: { txSig: string; network: string }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-bg p-2 text-xs">
      <div className="flex items-center gap-1.5 text-fg">
        <Check className="h-3.5 w-3.5 text-brand" />
        <span className="font-medium">Withdraw confirmed</span>
      </div>
      <Link
        href={solscanTxUrl(txSig, network)}
        target="_blank"
        rel="noopener noreferrer"
        className="block font-mono text-[11px] text-brand hover:underline"
      >
        Tx {shortHash(txSig)} on Solscan
      </Link>
    </div>
  );
}

function prettyNet(n: string): string {
  const lower = n.toLowerCase();
  if (lower.includes('devnet')) return 'devnet';
  if (lower.includes('mainnet')) return 'mainnet';
  return n;
}

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function fmtAvailable(n: number): string {
  if (n === 0) return '0';
  if (n >= 1) {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
      useGrouping: true,
    }).format(n);
  }
  if (n < 0.0001) return n.toExponential(2);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
    useGrouping: true,
  }).format(n);
}
