'use client';

/**
 * Pay request card.
 *
 * Server-side `leash_pay_payment_link` cannot settle on its own — the
 * operator key lives in the user's Privy wallet, never on the server.
 * Instead it returns a `payment_request` artifact (this component) that
 * surfaces the demanded price + a one-click Pay button. Clicking the
 * button does the real x402 dance entirely in the browser:
 *
 *   1. Resolve the agent record for caps + treasury network.
 *   2. Build a `@solana/kit` signer from the Privy embedded wallet.
 *   3. Derive the agent treasury ATA for the demanded asset.
 *   4. `createBuyer({...}).fetch(url)` → 402 → seller settles via the
 *      facilitator → 200 + PAYMENT-RESPONSE header.
 *   5. Show the receipt (txSig + receipt hash + explorer link) inline.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import useSWR from 'swr';
import { usePrivy } from '@privy-io/react-auth';
import { Check, Loader2 } from 'lucide-react';
import { createBuyer } from '@leash/buyer-kit';
import {
  deriveAgentTreasuryAta,
  KNOWN_STABLE_SYMBOLS,
  parseLeashHeaders,
  type LeashX402Network,
  type KnownStableSymbol,
} from '@leash/core';
import type { RulesV1 } from '@leash/schemas';

import { Button } from '@/components/ui/button';
import { txUrl, receiptUrl, shortHash } from '@/lib/explorer';
import { usePrivySvmSigner } from '@/lib/privy-svm-signer';
import { SOLANA_RPC } from '@/lib/env';
import { markPayRequestPaid } from '@/lib/chat-storage';

export type PayRequestPayload = {
  url?: string;
  agent_mint?: string;
  preview?: {
    network?: string;
    pay_to?: string;
    asset?: string;
    amount_atomic?: string;
    currency?: string;
    description?: string;
  };
  /**
   * Stamped onto the payload by `markPayRequestPaid` after a successful
   * settlement so the Pay card hydrates to its "Payment confirmed"
   * state on full page refresh — no side-store, the artifact itself
   * is the source of truth.
   */
  paid_tx_sig?: string;
  paid_receipt_hash?: string;
};

type AgentRecord = {
  mint: string;
  network: 'solana-devnet' | 'solana-mainnet';
  budget?: { per_action?: string; per_task?: string; per_day?: string };
};

type FlowState =
  | { kind: 'idle' }
  | { kind: 'paying' }
  | {
      kind: 'paid';
      txSig: string | null;
      receiptHash: string;
    }
  | { kind: 'failed'; reason: string };

const agentsFetcher = async (url: string) => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { items: [] as AgentRecord[] };
  return res.json() as Promise<{ items: AgentRecord[] }>;
};

export function PayRequestArtifact({
  payload,
  threadId,
}: {
  payload: PayRequestPayload;
  threadId?: string;
}) {
  const url = payload.url ?? '';
  const agentMint = payload.agent_mint ?? '';
  const preview = payload.preview;

  const { signer } = usePrivySvmSigner();
  const { user } = usePrivy();
  // Revalidate on focus so a cap edit on /profile/spend takes effect
  // the moment the user comes back to chat — no refresh needed. Short
  // dedupe so the per-action cap check above always reflects the
  // latest persisted budget.
  const { data } = useSWR<{ items: AgentRecord[] }>('/api/agents', agentsFetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 5_000,
  });
  const agent = useMemo(
    () => data?.items.find((a) => a.mint === agentMint) ?? data?.items[0] ?? null,
    [data, agentMint],
  );
  // Hydrate from persisted artifact state — `markPayRequestPaid` stamps
  // the payload after a successful pay, so refreshing the page lands us
  // straight in the "Payment confirmed" view instead of re-prompting.
  const [state, setState] = useState<FlowState>(() => {
    if (payload.paid_receipt_hash) {
      return {
        kind: 'paid',
        txSig: payload.paid_tx_sig ?? null,
        receiptHash: payload.paid_receipt_hash,
      };
    }
    return { kind: 'idle' };
  });

  const niceCurrency = preview?.currency ?? 'USDC';
  const niceAmount = preview?.amount_atomic
    ? formatAmount(preview.amount_atomic, decimalsForCurrency(niceCurrency))
    : null;
  const niceNetwork = prettyNet(preview?.network ?? agent?.network ?? '');

  // Pre-flight check: refuse to call buyer.fetch() if this single
  // payment would exceed the agent's configured per-action cap. This
  // is the soft policy gate — the on-chain SPL delegate is a separate
  // hard ceiling the operator approved at onboarding. Caps marked
  // 'unlimited' (Phase 3 toggle) skip enforcement entirely; the
  // operator approves each payment manually anyway.
  const capCheck = useMemo<{ ok: true } | { ok: false; reason: string }>(() => {
    const cap = agent?.budget?.per_action;
    const atomic = preview?.amount_atomic;
    if (!cap || !atomic) return { ok: true };
    if (isUnlimited(cap)) return { ok: true };
    const capNum = Number.parseFloat(cap);
    if (!Number.isFinite(capNum) || capNum <= 0) return { ok: true };
    const amountDecimal = atomicToDecimal(atomic, decimalsForCurrency(niceCurrency));
    if (amountDecimal === null) return { ok: true };
    if (amountDecimal > capNum) {
      return {
        ok: false,
        reason: `Exceeds per-action cap (${capNum} ${niceCurrency}). Raise it on /profile/spend or set unlimited.`,
      };
    }
    return { ok: true };
  }, [agent?.budget?.per_action, preview?.amount_atomic, niceCurrency]);

  async function approveAndPay() {
    if (!url) {
      toast.error('Pay request is missing a URL.');
      return;
    }
    if (!agent) {
      toast.error('No on-chain agent on file', {
        description: 'Mint one under Profile → Agent first.',
      });
      return;
    }
    if (!signer) {
      toast.error('Wallet not ready', {
        description: 'Connect your Privy wallet so the operator can sign.',
      });
      return;
    }
    if (!preview?.asset) {
      toast.error('Cannot pay — seller did not advertise an asset.');
      return;
    }
    if (!capCheck.ok) {
      toast.error('Blocked by spend cap', { description: capCheck.reason });
      return;
    }
    setState({ kind: 'paying' });
    try {
      // Derive the treasury ATA for the asset the seller demanded so we
      // pay from the right token bucket (USDC vs USDG vs USDT).
      const { ata } = await deriveAgentTreasuryAta({
        asset: agent.mint,
        mint: preview.asset,
      });
      const sourceTokenAccount = String(ata);

      // Build a permissive RulesV1 from the agent's caps. The actual
      // hard ceiling lives on-chain (the SPL delegate allowance);
      // this is just the buyer-kit's pre-flight policy gate so we
      // never *attempt* to spend over the cap. "Unlimited" caps map
      // to a very large number — we already gated on `capCheck`
      // above, so buyer-kit doesn't need to redo the check.
      const HUGE = '1000000';
      const perCallStr = agent.budget?.per_action;
      const perDayStr = agent.budget?.per_day;
      const rules: RulesV1 = {
        v: '0.1',
        budget: {
          perCall: !perCallStr || isUnlimited(perCallStr) ? HUGE : perCallStr,
          daily: !perDayStr || isUnlimited(perDayStr) ? HUGE : perDayStr,
          currency: 'USDC',
        },
        hosts: {},
        triggers: [],
      };
      const network: LeashX402Network = agent.network;
      const buyer = createBuyer({
        agent: agent.mint,
        rules,
        signer,
        networks: [network],
        rpcUrl: SOLANA_RPC,
        sourceTokenAccount,
        preferredCurrency: matchKnownStable(niceCurrency),
        // Opt out of receipt fan-out from the browser. The seller's
        // facilitator already records receipts server-side; doing it
        // again would just double-write to the explorer.
        onReceipt: false,
      });
      // Prefer the same-origin BFF proxy at `/x/<id>` (mirrors the
      // playground). It avoids cross-origin CORS preflights against
      // `apps/api` from the browser, which is the most common reason a
      // buyer.fetch() fails with a generic "Failed to fetch". The
      // proxy is a transparent passthrough so the seller-kit on the
      // upstream side still verifies + settles exactly the same way.
      const target = sameOriginPaywallUrl(url) ?? url;
      const result = await buyer.fetch(target);
      if (result.failureReason || !result.receipt.tx_sig) {
        const reason = result.failureReason ?? `seller returned HTTP ${result.response.status}`;
        setState({ kind: 'failed', reason });
        toast.error('Payment failed', { description: reason });
        return;
      }
      // Prefer the seller-side receipt hash stamped by `apps/api`'s
      // paywall via `X-Leash-Receipt-Hash`. The buyer-kit's local
      // `result.receipt.receipt_hash` is computed independently from
      // the buyer's view of the request (different `nonce`/`ts`), so
      // the two hashes diverge and the explorer only knows about the
      // seller-side one. Falling back to the local hash is fine when
      // the seller doesn't stamp headers (legacy paywalls).
      const stamped = parseLeashHeaders(result.response);
      const txSig = stamped.txSig ?? result.receipt.tx_sig;
      const receiptHash = stamped.receiptHash ?? result.receipt.receipt_hash;
      setState({
        kind: 'paid',
        txSig,
        receiptHash,
      });
      // Persist the settled state into the artifact payload so the Pay
      // card hydrates to "Payment confirmed" on full page refresh.
      // Mutating `payload` in place also keeps the in-memory artifact
      // consistent with what's now in localStorage.
      try {
        if (user?.id && threadId && url) {
          markPayRequestPaid(user.id, threadId, url, {
            tx_sig: txSig ?? '',
            receipt_hash: receiptHash,
          });
          payload.paid_tx_sig = txSig ?? undefined;
          payload.paid_receipt_hash = receiptHash;
        }
      } catch {
        // Storage failures shouldn't break the success toast — the
        // user already paid, this is just persistence polish.
      }
      toast.success('Paid', { description: `Tx ${shortHash(txSig)}` });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown error';
      setState({ kind: 'failed', reason });
      toast.error('Payment failed', { description: reason });
    }
  }

  return (
    <div className="rounded-lg border border-border bg-bg-elev p-3 text-sm space-y-3">
      <div className="space-y-0.5">
        <div className="text-xs font-medium text-fg-muted">Pay request</div>
        <div className="text-fg font-medium truncate">
          {preview?.description || 'Approve this payment'}
        </div>
        {niceAmount ? (
          <div className="text-xs text-fg-muted">
            {niceAmount} {niceCurrency}
            {niceNetwork ? <span className="ml-2 opacity-70">· {niceNetwork}</span> : null}
          </div>
        ) : null}
      </div>

      {url ? (
        <Link
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="block font-mono text-[11px] text-brand break-all hover:underline"
        >
          {url}
        </Link>
      ) : null}

      {state.kind === 'paid' ? (
        <PaidReceipt txSig={state.txSig} receiptHash={state.receiptHash} />
      ) : (
        <div className="space-y-1.5 pt-0.5">
          {!capCheck.ok ? (
            <div className="rounded-md border border-warning/40 bg-warning/8 px-2 py-1.5 text-[11px] text-warning leading-snug">
              {capCheck.reason}
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={approveAndPay}
              disabled={state.kind === 'paying' || !signer || !agent || !capCheck.ok}
              className="h-7 px-2 text-xs"
            >
              {state.kind === 'paying' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  Paying…
                </>
              ) : (
                <>Approve &amp; pay</>
              )}
            </Button>
          </div>
        </div>
      )}

      {state.kind === 'failed' ? (
        <div className="text-xs text-danger break-words">Failed: {state.reason}</div>
      ) : null}
    </div>
  );
}

function PaidReceipt({ txSig, receiptHash }: { txSig: string | null; receiptHash: string }) {
  return (
    <div className="space-y-1.5 rounded-md border border-border bg-bg p-2 text-xs">
      <div className="flex items-center gap-1.5 text-fg">
        <Check className="h-3.5 w-3.5 text-brand" />
        <span className="font-medium">Payment confirmed</span>
      </div>
      {txSig ? (
        <Link
          href={txUrl(txSig)}
          target="_blank"
          rel="noopener noreferrer"
          className="block font-mono text-[11px] text-brand hover:underline"
        >
          Tx {shortHash(txSig)}
        </Link>
      ) : null}
      {receiptHash ? (
        <Link
          href={receiptUrl(receiptHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="block font-mono text-[11px] text-brand hover:underline"
        >
          Receipt {shortHash(receiptHash)}
        </Link>
      ) : null}
    </div>
  );
}

function decimalsForCurrency(c: string): number {
  // All the stables we support are 6 decimals on Solana.
  if (c === 'SOL') return 9;
  return 6;
}

/**
 * Sentinel "no soft cap" — written by the /profile/spend "Unlimited"
 * toggle. The Pay card's per-action gate skips enforcement when the
 * cap is unlimited; the operator approves each payment manually.
 */
function isUnlimited(cap: string): boolean {
  const v = cap.trim().toLowerCase();
  return v === 'unlimited' || v === 'inf' || v === 'infinity' || v === '';
}

/**
 * Convert atomic-units integer string (e.g. "15000000" for 15 USDC at
 * 6 decimals) to a regular decimal number for cap comparison.
 * Returns null on parse failure so the caller can soft-fail instead
 * of blocking the user with a confusing error.
 */
function atomicToDecimal(atomic: string, decimals: number): number | null {
  let big: bigint;
  try {
    big = BigInt(atomic);
  } catch {
    return null;
  }
  const base = 10n ** BigInt(decimals);
  const whole = Number(big / base);
  const frac = Number(big % base) / Number(base);
  return whole + frac;
}

function formatAmount(atomic: string, decimals: number): string {
  let n: bigint;
  try {
    n = BigInt(atomic);
  } catch {
    return atomic;
  }
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  if (frac === 0n) return new Intl.NumberFormat('en-US').format(whole);
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${new Intl.NumberFormat('en-US').format(whole)}.${fracStr}`;
}

function matchKnownStable(symbol: string): KnownStableSymbol | undefined {
  const upper = symbol.toUpperCase();
  return KNOWN_STABLE_SYMBOLS.find((s) => s === upper);
}

function prettyNet(n: string): string {
  if (n === 'solana-devnet' || n.toLowerCase().includes('devnet')) return 'devnet';
  if (n === 'solana-mainnet' || n.toLowerCase().includes('mainnet')) return 'mainnet';
  return n;
}

/**
 * Rewrite `https://api.leash.market/x/<id>?…` (or any cross-origin
 * paywall URL) to `<window.origin>/x/<id>?…` so buyer-kit hits our
 * same-origin BFF proxy at `app/x/[id]/route.ts`. Returns `null`
 * when the URL is already same-origin (or can't be parsed) so the
 * caller can fall back to the original.
 */
function sameOriginPaywallUrl(url: string): string | null {
  if (typeof window === 'undefined') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin === window.location.origin) return null;
  const match = parsed.pathname.match(/^\/x\/([^/]+)\/?$/);
  if (!match) return null;
  const id = match[1];
  const local = new URL(`/x/${id}`, window.location.origin);
  parsed.searchParams.forEach((v, k) => local.searchParams.set(k, v));
  return local.toString();
}
