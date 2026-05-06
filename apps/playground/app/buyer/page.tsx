'use client';

import * as React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ExternalLink, Plus, Receipt, Send, Shield, ShieldOff, Trash2, Wallet } from 'lucide-react';
import { createBuyer, type BuyerCallResult } from '@leashmarket/buyer-kit';
import {
  applyFeeGrossUp,
  deriveAgentTreasuryAta,
  fetchPaymentLinkMeta,
  KNOWN_STABLE_SYMBOLS,
  lookupToken,
  lookupTokenBySymbol,
  networkFromRpc,
  TOKEN_2022_PROGRAM_ADDRESS,
  type KnownStableSymbol,
} from '@leashmarket/core';
import {
  type EndpointV1,
  type ReceiptAny,
  type RulesV1,
  settlementTxSig,
} from '@leashmarket/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { InlineCode } from '@/components/ui/code';
import { useToast } from '@/components/ui/toast';
import { usePrivySvmSigner } from '@/lib/privy-svm-signer';
import { usePrivyUmi } from '@/lib/privy-umi';
import { transactionExplorerUrl } from '@/lib/solscan';
import { FACILITATOR_URL, SOLANA_NETWORK, SOLANA_RPC, facilitatorDisplayHost } from '@/lib/env';
import {
  effectiveRules,
  isLimitless,
  LIMITLESS_RULES,
  listAgents,
  loadAgent,
  type StoredAgent,
} from '@/lib/agent-storage';
import {
  getSpendDelegation,
  TOKEN_2022_PROGRAM_ID,
  type SpendDelegationStatus,
} from '@leashmarket/registry-utils';
import { formatReceiptPriceWithCurrency } from '@/lib/format-receipt-price';

const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Convert a `1.23` decimal string into atomic USDC units (`1230000n`). */
function decimalToAtomicUsdc(input: string): bigint | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/^(\d+)(?:\.(\d{1,6}))?$/);
  if (!m) return null;
  const whole = m[1];
  const frac = (m[2] ?? '').padEnd(6, '0');
  return BigInt(whole) * 1_000_000n + BigInt(frac);
}

type FireResult =
  | {
      ok: true;
      receipt: ReceiptAny;
      quotedPrice?: ReceiptAny['price'];
      failureReason?: string;
      /**
       * `Pay with` value when `fire()` ran. The seller 402 header often
       * still names the link primary (e.g. USDC) even when `accepts[]`
       * includes USDG — this field drives accurate failure copy.
       */
      attemptedPayCurrency?: KnownStableSymbol;
      /**
       * Snapshot of the treasury balance / approved allowance at fire-time.
       * Used by `ResultPanel` to reclassify a generic 402 ("transaction
       * simulation failed") into a precise "insufficient balance" /
       * "insufficient allowance" diagnosis when the seller's quoted price
       * exceeds what we can actually spend.
       */
      treasury?: { balanceAtomic: bigint; delegatedAtomic: bigint };
      response: {
        status: number;
        body: unknown;
        leash: {
          tx_sig: string | null;
          receipt_hash: string | null;
          agent: string | null;
          tx_explorer: string | null;
          agent_explorer: string | null;
          redirected_to: string | null;
        };
      };
    }
  | { ok: false; error: string };

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
};

/**
 * Autonomous-agent cockpit.
 *
 * The user picks one of their agents (the "operator"). The Privy embedded
 * wallet acts as that agent's registered Executive (per Metaplex's Run an
 * Agent docs) and signs every x402 SPL transfer on the agent's behalf.
 * Behaviour rules captured at agent creation are enforced before each
 * call by `@leashmarket/buyer-kit`'s policy gate.
 */
export default function BuyerPage() {
  const toast = useToast();
  const { signer, wallet, ready } = usePrivySvmSigner();
  const { umi: privyUmi } = usePrivyUmi();

  const [agents, setAgents] = React.useState<
    Array<Pick<StoredAgent, 'mint' | 'label' | 'network'>>
  >([]);
  const [selectedAgent, setSelectedAgent] = React.useState<string>('');
  const [agentRecord, setAgentRecord] = React.useState<StoredAgent | null>(null);

  const [url, setUrl] = React.useState('/x/');
  const [method, setMethod] = React.useState<'GET' | 'POST'>('POST');
  const [body, setBody] = React.useState('{}');
  // Most x402 paywalls are tiny GETs; only POST users typically care about a
  // request body. Hide the textarea behind an explicit opt-in so the panel
  // doesn't shout "you owe me JSON" at users who just want to fire a GET.
  // Auto-flips on when a pasted URL carries a `?body=` param (see
  // `handleUrlChange`).
  const [includeBody, setIncludeBody] = React.useState(false);
  const [callbackUrl, setCallbackUrl] = React.useState('');
  const [payCurrency, setPayCurrency] = React.useState<KnownStableSymbol>('USDC');

  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<FireResult | null>(null);
  const [history, setHistory] = React.useState<ReceiptAny[]>([]);

  React.useEffect(() => {
    const a = listAgents();
    setAgents(a);
    if (a[0]?.mint && !selectedAgent) setSelectedAgent(a[0].mint);
  }, [selectedAgent]);

  React.useEffect(() => {
    if (!selectedAgent) return;
    setAgentRecord(loadAgent(selectedAgent));
  }, [selectedAgent]);

  const { data: linksData } = useSWR<{ endpoints: EndpointV1[] }>(`/api/endpoints`, fetcher, {
    refreshInterval: 8000,
  });
  const allLinks = linksData?.endpoints ?? [];
  const parsedTargetUrl = React.useMemo(() => {
    try {
      return new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://x');
    } catch {
      return null;
    }
  }, [url]);
  const looksLikeLeashLink = !!parsedTargetUrl?.pathname.match(/\/x\/[^/]+$/);
  const discoveryKey = looksLikeLeashLink ? `discovery:${parsedTargetUrl!.toString()}` : null;
  const { data: discoveredLinkMeta } = useSWR(
    discoveryKey,
    async () => {
      if (!parsedTargetUrl) return null;
      try {
        return await fetchPaymentLinkMeta(parsedTargetUrl.toString());
      } catch {
        // Cross-origin links without CORS or non-Leash URLs will fail
        // discovery; pre-flight falls back to the runner's local endpoint
        // list (allLinks) and then to seller-quoted price on 402.
        return null;
      }
    },
    { revalidateOnFocus: false },
  );
  React.useEffect(() => {
    if (!discoveredLinkMeta?.endpoint) return;

    if (discoveredLinkMeta.endpoint.method !== method) {
      setMethod(discoveredLinkMeta.endpoint.method);
    }
    if (parsedTargetUrl && discoveredLinkMeta.endpoint.url !== parsedTargetUrl.toString()) {
      setUrl(discoveredLinkMeta.endpoint.url);
    }
  }, [discoveredLinkMeta, method, parsedTargetUrl]);

  /**
   * The mint the *current* call will spend. Driven by the buyer's chosen
   * `payCurrency` (USDC / USDT / USDG) — NOT the agent's saved fundingMint
   * (which is just a default seed at agent-creation time).
   *
   * This is the load-bearing detail behind "I selected USDG but it spent
   * USDC": prior to this fix, treasury reads, source-ATA derivation, and
   * the seller selector all keyed off USDC regardless of what the user
   * picked. Now everything downstream — delegation reads, source-ATA
   * derivation, balance/allowance display — re-derives whenever the
   * dropdown changes.
   */
  // Match `/api/agents/balance` + agent profile: mint addresses follow the
  // configured RPC cluster, not only `StoredAgent.network` (which can skew).
  const tokenNetwork = React.useMemo(() => networkFromRpc(SOLANA_RPC), []);
  const payCurrencyToken = React.useMemo(
    () => lookupTokenBySymbol(payCurrency, tokenNetwork) ?? null,
    [payCurrency, tokenNetwork],
  );
  const fundingMint = React.useMemo(() => {
    if (payCurrencyToken) return payCurrencyToken.mint;
    if (agentRecord?.fundingMint) return agentRecord.fundingMint;
    return agentRecord?.network === 'solana-mainnet' ? USDC_MAINNET : USDC_DEVNET;
  }, [payCurrencyToken, agentRecord]);

  /** Registry row for `fundingMint` — drives Token vs Token-2022 ATA layout. */
  const fundingTokenMeta = React.useMemo(
    () => (fundingMint ? lookupToken(fundingMint, tokenNetwork) : undefined),
    [fundingMint, tokenNetwork],
  );

  // Re-derive the treasury source ATA from `(agent_treasury_pda, fundingMint)`
  // every time the user switches currency, so we never spend out of a USDC
  // ATA when they asked to pay in USDG. Falls back to the agent's saved
  // ATA only when its mint matches the current funding mint.
  const [derivedSourceAta, setDerivedSourceAta] = React.useState<string | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    if (!selectedAgent || !fundingMint) {
      setDerivedSourceAta(null);
      return;
    }
    void (async () => {
      try {
        const { ata } = await deriveAgentTreasuryAta({
          asset: selectedAgent,
          mint: fundingMint,
          ...(fundingTokenMeta?.program === 'spl-token-2022'
            ? { tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }
            : {}),
        });
        if (!cancelled) setDerivedSourceAta(String(ata));
      } catch {
        if (!cancelled) setDerivedSourceAta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAgent, fundingMint, fundingTokenMeta?.program]);

  const sourceTokenAccountForFire =
    derivedSourceAta ??
    (agentRecord?.fundingMint === fundingMint ? agentRecord?.sourceTokenAccount : undefined) ??
    undefined;

  const [delegation, setDelegation] = React.useState<SpendDelegationStatus | null>(null);
  const [delegationLoading, setDelegationLoading] = React.useState(false);
  const [delegationError, setDelegationError] = React.useState<string | null>(null);

  const refreshDelegation = React.useCallback(async () => {
    if (!privyUmi || !selectedAgent) {
      setDelegation(null);
      return;
    }
    setDelegationLoading(true);
    setDelegationError(null);
    try {
      const status = await getSpendDelegation(privyUmi, {
        agentAsset: selectedAgent,
        mint: fundingMint,
        ...(fundingTokenMeta?.program === 'spl-token-2022'
          ? { tokenProgram: TOKEN_2022_PROGRAM_ID }
          : {}),
      });
      setDelegation(status);
    } catch (err) {
      setDelegation(null);
      setDelegationError(err instanceof Error ? err.message : String(err));
    } finally {
      setDelegationLoading(false);
    }
  }, [privyUmi, selectedAgent, fundingMint, fundingTokenMeta?.program]);

  React.useEffect(() => {
    void refreshDelegation();
  }, [refreshDelegation]);

  // Quoted price for the link the user is currently aiming at — used to gate
  // the Fire button when the delegation is too small to cover the call.
  // All Leash-supported stables (USDC/USDT/USDG) share 6 decimals so the
  // atomic conversion is currency-independent; if we ever add a non-6dp
  // stable this will need to key off `decimalToAtomic(s, token.decimals)`.
  //
  // We gross-up by the default 1% protocol fee here so the balance /
  // allowance pre-flights check against what the buyer will actually
  // sign (`net + fee`), not just the seller's quoted net. The
  // facilitator's authoritative fee block arrives on the 402 round-trip
  // (`callResult.quotedPrice.gross`) and overrides this estimate
  // post-fire — the env-default keeps the Fire button accurate even
  // before the first probe.
  const quotedAtomic: bigint | null = React.useMemo(() => {
    const grossUp = (net: bigint | null): bigint | null => {
      if (net == null) return null;
      try {
        return net + applyFeeGrossUp(net).fee;
      } catch {
        return net;
      }
    };
    const fromDiscovery = discoveredLinkMeta?.endpoint.price;
    if (fromDiscovery) {
      const m = fromDiscovery.match(/^([\d.]+)\s*([A-Z]+)$/);
      if (m) return grossUp(decimalToAtomicUsdc(m[1]));
    }
    try {
      const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://x');
      const m = u.pathname.match(/\/x\/([^/]+)/);
      if (!m) return null;
      const ep = allLinks.find((e) => e.id === m[1]);
      if (!ep?.price) return null;
      const priceMatch = ep.price.match(/^([\d.]+)\s*([A-Z]+)$/);
      if (!priceMatch) return null;
      return grossUp(decimalToAtomicUsdc(priceMatch[1]));
    } catch {
      return null;
    }
  }, [url, allLinks, discoveredLinkMeta]);

  /**
   * Pre-flight check: does the seller actually accept the buyer's chosen
   * settlement currency? Drives the `Fire request` button disabled state
   * AND surfaces an inline message right under the "Pay with" dropdown so
   * users know *before* signing why the call would be rejected.
   *
   * Only runs when we have a discovered payment-link meta (`/x/<id>`
   * routes); for arbitrary x402 URLs we can't know up-front, so the SDK's
   * selector throws `preferred_asset_unavailable` at fire-time and the
   * receipt records the reason.
   */
  const sellerAcceptsPayCurrency = React.useMemo(() => {
    if (!discoveredLinkMeta) return null;
    const ep = discoveredLinkMeta.endpoint;
    return ep.currency === payCurrency || ep.accepts_currencies.includes(payCurrency);
  }, [discoveredLinkMeta, payCurrency]);

  const insufficientDelegation =
    delegation != null &&
    quotedAtomic != null &&
    (delegation.delegatedAmount < quotedAtomic || delegation.balance < quotedAtomic);

  const rules: RulesV1 = React.useMemo(() => {
    if (agentRecord?.rules) return agentRecord.rules;
    if (agentRecord?.rules === null) return LIMITLESS_RULES;
    return selectedAgent ? effectiveRules(selectedAgent) : LIMITLESS_RULES;
  }, [agentRecord, selectedAgent]);
  const isLimitlessAgent = isLimitless(agentRecord?.rules ?? null);
  const rulesCardData = isLimitlessAgent ? {} : rules;

  async function shipReceipt(receipt: ReceiptAny): Promise<void> {
    try {
      await fetch(`/api/receipts/${encodeURIComponent(receipt.agent)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(receipt),
      });
    } catch {
      /* runner outage is silent on this side */
    }
  }

  async function fire() {
    if (!signer) {
      const msg = 'Connect a Solana wallet first.';
      setResult({ ok: false, error: msg });
      toast.error('Wallet required', msg);
      return;
    }
    if (!selectedAgent) {
      const msg = 'Pick an agent first.';
      setResult({ ok: false, error: msg });
      toast.error('Agent required', msg);
      return;
    }

    // Pre-flight A — currency acceptance: if discovery told us the seller
    // only accepts USDC and the user picked USDG, refuse to even open the
    // signer popup. Without this gate the SDK selector would throw
    // `preferred_asset_unavailable` mid-fetch which is a worse UX
    // (delayed feedback, harder-to-read receipt) for what is really a
    // configuration mistake the UI already knows about.
    if (sellerAcceptsPayCurrency === false && discoveredLinkMeta) {
      const offered = [
        discoveredLinkMeta.endpoint.currency,
        ...discoveredLinkMeta.endpoint.accepts_currencies,
      ].join(', ');
      const msg = `This payment link doesn't accept ${payCurrency}. The seller settles in ${offered}. Switch the "Pay with" dropdown to one of those.`;
      setResult({ ok: false, error: msg });
      toast.error(`Seller doesn't accept ${payCurrency}`, msg);
      return;
    }

    // Pre-flight B — re-read on-chain delegation right before firing so the
    // gate reflects reality (the user might have just topped up in another
    // tab) and we never burn a Privy popup on a call we already know will
    // revert.
    let live: SpendDelegationStatus | null = delegation;
    try {
      if (privyUmi) {
        live = await getSpendDelegation(privyUmi, {
          agentAsset: selectedAgent,
          mint: fundingMint,
          ...(fundingTokenMeta?.program === 'spl-token-2022'
            ? { tokenProgram: TOKEN_2022_PROGRAM_ID }
            : {}),
        });
        setDelegation(live);
      }
    } catch {
      /* fall back to the cached delegation read above */
    }

    if (live && quotedAtomic != null) {
      if (live.balance < quotedAtomic) {
        const have = (Number(live.balance) / 1_000_000).toFixed(6);
        const need = (Number(quotedAtomic) / 1_000_000).toFixed(6);
        const msg = `Treasury holds ${have} ${payCurrency} but the seller wants ${need} ${payCurrency}.`;
        setResult({ ok: false, error: msg });
        toast.error(`Insufficient ${payCurrency} balance`, msg);
        return;
      }
      if (live.delegatedAmount < quotedAtomic) {
        const have = (Number(live.delegatedAmount) / 1_000_000).toFixed(6);
        const need = (Number(quotedAtomic) / 1_000_000).toFixed(6);
        const msg = `Executive is approved for ${have} ${payCurrency} but this call needs ${need} ${payCurrency}. Re-approve a higher allowance on the agent profile.`;
        setResult({ ok: false, error: msg });
        toast.error('Insufficient allowance', msg);
        return;
      }
      if (!live.delegate) {
        const msg = `No ${payCurrency} delegate set on this agent. Open the agent profile and run "Set allowance" for ${payCurrency} first.`;
        setResult({ ok: false, error: msg });
        toast.error('Delegation missing', msg);
        return;
      }
    }

    setLoading(true);
    setResult(null);
    try {
      const target = new URL(url, window.location.origin).toString();
      const network =
        agentRecord?.network === 'solana-mainnet' || agentRecord?.network === 'solana-devnet'
          ? agentRecord.network
          : SOLANA_NETWORK;
      const buyer = createBuyer({
        agent: selectedAgent,
        rules,
        signer,
        networks: [network],
        rpcUrl: SOLANA_RPC,
        facilitator: FACILITATOR_URL,
        onReceipt: shipReceipt,
        preferredCurrency: payCurrency,
        // Per-currency source ATA. `derivedSourceAta` is computed from
        // `(agent_treasury_pda, fundingMint)` whenever the user changes
        // the "Pay with" dropdown, so spending USDG never accidentally
        // debits the USDC ATA.
        ...(sourceTokenAccountForFire ? { sourceTokenAccount: sourceTokenAccountForFire } : {}),
      });
      const sendBody = method === 'POST' && includeBody && body.trim().length > 0;
      const headers: Record<string, string> = {};
      if (sendBody) headers['content-type'] = 'application/json';
      if (callbackUrl.trim()) headers['x-leash-callback'] = callbackUrl.trim();

      const init: RequestInit = { method };
      if (Object.keys(headers).length > 0) init.headers = headers;
      if (sendBody) init.body = body;
      const callResult: BuyerCallResult = await buyer.fetch(target, init);
      const text = await callResult.response.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text);
      } catch {
        /* leave as text */
      }
      const h = callResult.response.headers;
      const redirected = callResult.response.redirected;
      const finalUrl = callResult.response.url || target;

      let urlLeash: {
        tx_sig: string | null;
        receipt_hash: string | null;
        agent: string | null;
      } = { tx_sig: null, receipt_hash: null, agent: null };
      try {
        const u = new URL(finalUrl);
        urlLeash = {
          tx_sig: u.searchParams.get('leash_tx'),
          receipt_hash: u.searchParams.get('leash_receipt'),
          agent: u.searchParams.get('leash_agent'),
        };
      } catch {
        /* opaque or invalid url — fall back to header values */
      }
      setResult({
        ok: true,
        receipt: callResult.receipt,
        quotedPrice: callResult.quotedPrice,
        failureReason: callResult.failureReason,
        attemptedPayCurrency: payCurrency,
        ...(live
          ? {
              treasury: {
                balanceAtomic: live.balance,
                delegatedAtomic: live.delegatedAmount,
              },
            }
          : {}),
        response: {
          status: callResult.response.status,
          body: parsed,
          leash: {
            tx_sig: h.get('x-leash-tx-sig') || urlLeash.tx_sig || null,
            receipt_hash: h.get('x-leash-receipt-hash') || urlLeash.receipt_hash || null,
            agent: h.get('x-leash-agent') || urlLeash.agent || null,
            tx_explorer: h.get('x-leash-tx-explorer') || null,
            agent_explorer: h.get('x-leash-agent-explorer') || null,
            redirected_to: redirected ? finalUrl : null,
          },
        },
      });
      setHistory((h) => [callResult.receipt, ...h].slice(0, 25));
      const settled = !!settlementTxSig(callResult.receipt);
      const status = callResult.response.status;
      // A `redirected` response (303 → followed) with status 0 is *not* a
      // network failure; it's a successful payment + redirect. Treat it
      // accordingly so the toast/panel match what actually happened on-chain.
      const isNetworkFailure = status === 0 && !callResult.response.redirected;

      // Authoritative quoted price from the seller's payment-required header
      // (parsed by buyer-kit). Convert to bigint atomic units so we can
      // compare against treasury / allowance. Prefer `gross` (net + fee)
      // when present so the comparison reflects what the buyer actually
      // signs on the wire — falling back to `amount` for vanilla x402
      // settlements that bypass the Leash facilitator (no fee leg).
      const quotedAtomicFromSeller: bigint | null = (() => {
        const raw = callResult.quotedPrice?.gross ?? callResult.quotedPrice?.amount;
        if (!raw) return null;
        try {
          return BigInt(raw);
        } catch {
          return null;
        }
      })();

      const reasonPrefix = (callResult.failureReason ?? '').split(':')[0]?.trim() ?? '';
      let insufficient: 'balance' | 'allowance' | null = null;
      if (reasonPrefix === 'insufficient_balance') insufficient = 'balance';
      else if (reasonPrefix === 'insufficient_allowance') insufficient = 'allowance';
      if (!insufficient && live && quotedAtomicFromSeller != null) {
        if (live.balance < quotedAtomicFromSeller) insufficient = 'balance';
        else if (live.delegatedAmount < quotedAtomicFromSeller) insufficient = 'allowance';
      }

      if (isNetworkFailure) {
        toast.error(
          'Network error — request never reached the seller',
          callResult.failureReason ??
            'The signer popup was likely cancelled, or the facilitator/RPC was unreachable.',
        );
      } else if (status === 402 && !settled && insufficient === 'balance' && live) {
        const have = (Number(live.balance) / 1_000_000).toFixed(6);
        const need = formatReceiptPriceWithCurrency(callResult.quotedPrice) ?? 'unknown';
        toast.error(
          'Insufficient balance to complete payment',
          `Treasury holds ${have} ${payCurrency} but the seller requires ${need}.`,
        );
      } else if (status === 402 && !settled && insufficient === 'allowance' && live) {
        const have = (Number(live.delegatedAmount) / 1_000_000).toFixed(6);
        const need = formatReceiptPriceWithCurrency(callResult.quotedPrice) ?? 'unknown';
        toast.error(
          'Insufficient allowance to complete payment',
          `Executive is approved for ${have} ${payCurrency} but the seller requires ${need}. Re-approve a higher allowance on the agent profile.`,
        );
      } else if (status === 402 && !settled) {
        const quoted = formatReceiptPriceWithCurrency(callResult.quotedPrice);
        const reason = callResult.failureReason ?? 'no failure reason returned by the seller';
        toast.error(`Settlement failed${quoted ? ` (asked ${quoted})` : ''}`, reason);
      } else if (settled) {
        void (async () => {
          await refreshDelegation();
          await new Promise((r) => window.setTimeout(r, 1500));
          await refreshDelegation();
          await new Promise((r) => window.setTimeout(r, 2500));
          await refreshDelegation();
        })();

        setBody('{}');
        setCallbackUrl('');
        toast.success(
          'x402 call completed',
          `Status ${status} · receipt ${callResult.receipt.receipt_hash.slice(0, 12)}…`,
        );
      } else {
        toast.info(
          'Call completed (no settlement)',
          `Status ${status} — endpoint did not require payment, or returned without a PAYMENT-RESPONSE header.`,
        );
      }
    } catch (err) {
      const msg = (err as Error).message ?? 'buyer.fetch failed';
      setResult({ ok: false, error: msg });
      toast.error('x402 call failed', msg);
    } finally {
      setLoading(false);
    }
  }

  function handleUrlChange(nextUrl: string) {
    setUrl(nextUrl);
    // If users paste a link with request body params, auto-fill the body box.
    // Supported keys: ?body=... or ?request_body=...
    if (typeof window === 'undefined') return;
    try {
      const parsed = new URL(nextUrl, window.location.origin);
      const raw =
        parsed.searchParams.get('body') ??
        parsed.searchParams.get('request_body') ??
        parsed.searchParams.get('requestBody');
      if (!raw) return;
      // Pasted URL carries a body — surface the textarea automatically so
      // the user actually sees the value that's about to be sent.
      setIncludeBody(true);
      try {
        const asJson = JSON.parse(raw) as unknown;
        setBody(JSON.stringify(asJson, null, 2));
      } catch {
        setBody(raw);
      }
    } catch {
      /* ignore invalid transient URL input while user is typing */
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leashmarket/buyer-kit"
        title="Autonomous-agent cockpit"
        description="Pick one of your agents, point it at any x402 URL on the open internet, and your Privy wallet will sign on its behalf as the registered Executive. Behaviour rules captured at agent creation gate every call."
      />

      {agents.length === 0 ? (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="flex flex-col gap-3 py-4">
            <p className="text-sm">You don&apos;t have any agents on this device yet.</p>
            <Button asChild className="w-fit">
              <Link href="/agents/new">
                <Plus className="size-4" /> Create agent
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Fire an x402 request</CardTitle>
              <CardDescription>
                Defaults to the in-app payment-link surface (<InlineCode>/x/&lt;id&gt;</InlineCode>
                ), but you can paste any x402 URL the agent has budget for.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-2 border-b border-border pb-4 text-xs">
                {!ready && <span className="text-fg-muted">Loading Privy…</span>}
                {ready && !wallet && (
                  <span className="text-warning">
                    Connect a Solana wallet (top-right) to sign x402 transfers.
                  </span>
                )}
                {ready && wallet && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-sm text-fg">
                      <Badge variant="brand">{SOLANA_NETWORK}</Badge>
                      <Badge variant="success">{facilitatorDisplayHost()}</Badge>
                    </div>
                  </>
                )}
              </div>

              <Field label="Agent (operator)">
                <select
                  value={selectedAgent}
                  onChange={(e) => setSelectedAgent(e.target.value)}
                  className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm"
                >
                  {agents.map((a) => (
                    <option key={a.mint} value={a.mint}>
                      {a.label ?? `${a.mint.slice(0, 4)}…${a.mint.slice(-4)}`} · {a.network}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="URL">
                <Input
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  className="font-mono"
                  placeholder="/x/<id> or https://example.com/x402-route"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Method">
                  <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value as 'GET' | 'POST')}
                    className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                  </select>
                </Field>
                <Field label="Pay with">
                  <select
                    value={payCurrency}
                    onChange={(e) => setPayCurrency(e.target.value as KnownStableSymbol)}
                    className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm"
                  >
                    {KNOWN_STABLE_SYMBOLS.map((sym) => {
                      const accepted =
                        !discoveredLinkMeta ||
                        discoveredLinkMeta.endpoint.currency === sym ||
                        discoveredLinkMeta.endpoint.accepts_currencies.includes(sym);
                      return (
                        <option key={sym} value={sym}>
                          {sym}
                          {accepted ? '' : ' (not accepted by this link)'}
                        </option>
                      );
                    })}
                  </select>
                  {discoveredLinkMeta ? (
                    <span className="text-[11px] text-fg-subtle">
                      Seller accepts:{' '}
                      <span className="font-mono">
                        {[
                          discoveredLinkMeta.endpoint.currency,
                          ...discoveredLinkMeta.endpoint.accepts_currencies,
                        ].join(', ')}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-fg-subtle">
                      Buyer-kit will pick the matching currency.
                    </span>
                  )}
                  {sellerAcceptsPayCurrency === false && (
                    <span className="text-[11px] text-danger">
                      ⚠ This link does not accept {payCurrency}
                    </span>
                  )}
                </Field>
              </div>

              {method === 'POST' && (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-xs text-fg-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={includeBody}
                      onChange={(e) => setIncludeBody(e.target.checked)}
                      className="size-3.5 accent-brand"
                    />
                    Include a JSON request body
                  </label>
                  {includeBody && (
                    <Field label="Body">
                      <Textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="{}"
                      />
                      <span className="text-[11px] text-fg-subtle">
                        Sent with <InlineCode>content-type: application/json</InlineCode>. Leave the
                        box unchecked to fire the POST without a body.
                      </span>
                    </Field>
                  )}
                </div>
              )}

              <Field label="Forward response to (optional)">
                <Input
                  value={callbackUrl}
                  onChange={(e) => setCallbackUrl(e.target.value)}
                  type="url"
                  className="font-mono text-xs"
                  placeholder="https://your-agent.com/leash-callback"
                />
                <span className="text-[11px] text-fg-subtle">
                  Sent as <InlineCode>x-leash-callback</InlineCode>. After settlement the seller
                  fires <InlineCode>{'{ payment, response }'}</InlineCode> to this URL — useful for
                  chaining one agent&rsquo;s output into another.
                </span>
              </Field>

              {allLinks.length > 0 && (
                <div className="flex flex-col gap-1">
                  <Label>Quick-pick saved payment links</Label>
                  <div className="flex flex-wrap gap-1">
                    {allLinks.slice(0, 8).map((ep) => (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => {
                          setUrl(`/x/${ep.id}`);
                          setMethod(ep.method);
                        }}
                        className="text-[11px] rounded border border-border bg-bg-elev px-2 py-0.5 hover:border-border-strong text-fg-muted hover:text-fg"
                        title={`${ep.method} /x/${ep.id} · ${ep.price}`}
                      >
                        {ep.label} · {ep.price}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Separator />

              <div className="flex items-center gap-2">
                {isLimitlessAgent ? (
                  <Badge variant="outline" className="gap-1">
                    <ShieldOff className="size-3" /> limitless
                  </Badge>
                ) : (
                  <Badge variant="brand" className="gap-1">
                    <Shield className="size-3" /> rules enforced
                  </Badge>
                )}
                <span className="text-[11px] text-fg-muted">
                  Rules are read from this agent&apos;s record (set at creation).{' '}
                  {selectedAgent && (
                    <Link href={`/agents/${selectedAgent}`} className="underline hover:text-fg">
                      Edit on profile →
                    </Link>
                  )}
                </span>
              </div>

              <Button
                onClick={fire}
                disabled={
                  loading ||
                  !signer ||
                  !selectedAgent ||
                  insufficientDelegation ||
                  sellerAcceptsPayCurrency === false
                }
                size="lg"
              >
                <Send />{' '}
                {loading
                  ? 'Signing & paying…'
                  : sellerAcceptsPayCurrency === false
                    ? `Seller doesn't accept ${payCurrency}`
                    : insufficientDelegation
                      ? `Insufficient ${payCurrency} treasury / allowance`
                      : `Fire request (${payCurrency})`}
              </Button>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wallet className="size-4 text-brand" /> Agent treasury &amp; allowance
                </CardTitle>
                <CardDescription>
                  How much {payCurrency} the agent holds and how much your executive wallet is
                  approved to spend on its behalf. Both are read straight from the agent&apos;s
                  on-chain {payCurrency} ATA — switching the &quot;Pay with&quot; dropdown above
                  re-reads the correct token.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                {!selectedAgent ? (
                  <p className="text-fg-muted">Pick an agent to see treasury status.</p>
                ) : delegationError ? (
                  <p className="text-danger">{delegationError}</p>
                ) : delegationLoading && !delegation ? (
                  <p className="text-fg-muted">Reading on-chain delegation…</p>
                ) : delegation ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Stat
                        label={`${payCurrency} balance`}
                        value={`${(Number(delegation.balance) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${payCurrency}`}
                        sub={delegation.sourceExists ? 'ATA initialised' : 'ATA not yet created'}
                      />
                      <Stat
                        label="Remaining allowance"
                        value={`${(Number(delegation.delegatedAmount) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${payCurrency}`}
                        sub={
                          delegation.delegate
                            ? `delegate ${delegation.delegate.slice(0, 6)}…${delegation.delegate.slice(-4)}`
                            : 'no delegate set'
                        }
                      />
                    </div>
                    {!sourceTokenAccountForFire && (
                      <p className="text-warning">
                        Could not derive a {payCurrency} treasury ATA for this agent. Open the agent
                        profile and run <em>Set allowance</em> for {payCurrency} to wire up the
                        treasury.
                      </p>
                    )}
                    {insufficientDelegation && (
                      <p className="text-danger">
                        Quoted price exceeds the remaining allowance or treasury balance for this
                        agent. Re-approve a higher allowance and/or top up the treasury before
                        firing.
                      </p>
                    )}
                    {selectedAgent && (
                      <Link
                        href={`/agents/${encodeURIComponent(selectedAgent)}`}
                        className="text-brand hover:underline w-fit"
                      >
                        Manage allowance on agent profile →
                      </Link>
                    )}
                  </>
                ) : (
                  <p className="text-fg-muted">Connect a wallet to read delegation.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="size-4 text-brand" /> Active RulesV1
                </CardTitle>
                <CardDescription>
                  Effective rules for the selected agent (limitless agents get a wide-open allow-all
                  preset).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <JsonViewer data={rulesCardData} maxHeight="14rem" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Latest result</CardTitle>
                <CardDescription>
                  Browser-side <InlineCode>createBuyer().fetch(url)</InlineCode>. Privy signs the
                  SPL transfer; <InlineCode>{facilitatorDisplayHost()}</InlineCode> settles.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {!result && (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
                    Fire a request to see a receipt.
                  </div>
                )}
                {result && !result.ok && <p className="text-sm text-danger">{result.error}</p>}
                {result && result.ok && <ResultPanel result={result} />}
              </CardContent>
            </Card>

            {history.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    Session history
                    <Button variant="ghost" size="sm" onClick={() => setHistory([])}>
                      <Trash2 className="size-3.5" /> Clear
                    </Button>
                  </CardTitle>
                  <CardDescription>
                    Receipts from this browser session, also shipped to the runner via{' '}
                    <InlineCode>onReceipt</InlineCode>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {history.map((r) => {
                    const hTx = settlementTxSig(r);
                    return (
                      <div
                        key={r.receipt_hash}
                        className="flex items-center gap-2 text-xs font-mono text-fg-muted"
                      >
                        <Badge variant={r.decision === 'allow' ? 'success' : 'danger'}>
                          {r.decision}
                        </Badge>
                        <span className="truncate">
                          {r.request.method} {r.request.url}
                        </span>
                        {hTx && r.price?.network && (
                          <a
                            href={transactionExplorerUrl(r.price.network, hTx)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand hover:underline"
                          >
                            {hTx.slice(0, 6)}…
                          </a>
                        )}
                        <span className="ml-auto text-fg-subtle">#{r.nonce}</span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Devnet-only: show the correct mint + faucet guidance for the stable actually paid. */
function DevnetStableFundHint({ symbol }: { symbol: string }) {
  if (networkFromRpc(SOLANA_RPC) !== 'devnet') return null;
  const upper = symbol.trim().toUpperCase();
  if (!KNOWN_STABLE_SYMBOLS.includes(upper as KnownStableSymbol)) return null;
  const meta = lookupTokenBySymbol(upper, 'devnet');
  if (!meta) return null;
  const isUsdc = upper === 'USDC';
  return (
    <li>
      {isUsdc ? 'Mint' : 'Obtain'} devnet {meta.symbol} (<InlineCode>{meta.mint}</InlineCode>) and
      send it to the agent treasury ATA
      {isUsdc ? (
        <>
          {' '}
          via{' '}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
          >
            faucet.circle.com
          </a>
          .
        </>
      ) : (
        <>
          {' '}
          (try{' '}
          <a
            href="https://faucet.solana.com"
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
          >
            faucet.solana.com
          </a>{' '}
          or swap from devnet USDC).
        </>
      )}
    </li>
  );
}

function ResultPanel({ result }: { result: Extract<FireResult, { ok: true }> }) {
  const leash = result.response.leash;
  const receiptTx = settlementTxSig(result.receipt);
  const settled = !!receiptTx;
  const status = result.response.status;
  // A status-0 response that was actually `redirected` is a real,
  // settled call — the browser just stripped headers because the seller
  // returned 303. Don't render the red "network failed" panel for it.
  const networkFailed = status === 0 && !leash.redirected_to;
  const settlementFailed = status === 402 && !settled;

  // Re-derive the "why didn't this settle" classification inside the panel
  // so the visual matches the toast. We cannot reuse the closure scope from
  // `fire()` here because `ResultPanel` is rendered at a higher level.
  const quotedAtomic: bigint | null = (() => {
    // Prefer `gross` (net + Leash fee) when present so the
    // balance / allowance reclassification matches what the buyer
    // actually had to sign on the wire.
    const raw = result.quotedPrice?.gross ?? result.quotedPrice?.amount;
    if (!raw) return null;
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  })();
  let insufficient: 'balance' | 'allowance' | null = null;
  // First trust the receipt's own classification (set by buyer-kit's
  // pre-flight). Fall back to a local treasury-vs-quote comparison so older
  // call sites without RPC access still light up the right panel.
  const reasonPrefix = (result.failureReason ?? '').split(':')[0]?.trim() ?? '';
  if (reasonPrefix === 'insufficient_balance') insufficient = 'balance';
  else if (reasonPrefix === 'insufficient_allowance') insufficient = 'allowance';
  if (!insufficient && settlementFailed && result.treasury && quotedAtomic != null) {
    if (result.treasury.balanceAtomic < quotedAtomic) insufficient = 'balance';
    else if (result.treasury.delegatedAtomic < quotedAtomic) insufficient = 'allowance';
  }
  // The currency we *attempted* to spend in. Comes from either the
  // settlement receipt (truth, when settled) or the seller-quoted price on
  // a failed 402. Falls back to "tokens" so generic copy still reads
  // correctly when neither is present.
  const settledOrQuotedCurrency =
    (result.receipt.price?.currency as string | undefined) ??
    (result.quotedPrice?.currency as string | undefined) ??
    'tokens';
  /** When 402 fails, the quoted header may still say USDC while `Pay with` was USDG. */
  const failurePanelCurrency =
    (result.attemptedPayCurrency as string | undefined) ?? settledOrQuotedCurrency;
  const haveBalanceUsdc = result.treasury
    ? (Number(result.treasury.balanceAtomic) / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })
    : null;
  const haveAllowanceUsdc = result.treasury
    ? (Number(result.treasury.delegatedAtomic) / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      })
    : null;
  const needPretty = formatReceiptPriceWithCurrency(result.quotedPrice);
  const needDisplay: React.ReactNode =
    quotedAtomic != null && result.attemptedPayCurrency
      ? `${(Number(quotedAtomic) / 1_000_000).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        })} ${result.attemptedPayCurrency}`
      : (needPretty ?? 'unknown');

  // Special-case: the SDK selector threw because the seller doesn't accept
  // the buyer's chosen currency. We surface this as its own panel because
  // it's a configuration mismatch, not a balance/allowance/funding issue.
  const preferredAssetUnavailable = (result.failureReason ?? '').startsWith(
    'preferred_asset_unavailable',
  );
  // Anything else that's not a settlement and not 402 is treated as
  // "endpoint didn't ask for payment" (e.g. /x/<id> is free, or returned
  // a 5xx after settlement). We render a neutral note rather than a green
  // "settled" badge to avoid the misleading "Response as payment completed,
  // no settlement" copy users were seeing.
  const statusBadgeVariant: 'success' | 'warning' | 'danger' = networkFailed
    ? 'danger'
    : status >= 400
      ? 'warning'
      : 'success';
  const settlementBadge: { variant: 'success' | 'danger' | 'outline'; label: string } = settled
    ? { variant: 'success', label: 'settled on-chain' }
    : networkFailed
      ? { variant: 'danger', label: 'never sent' }
      : settlementFailed
        ? { variant: 'danger', label: 'settlement failed' }
        : { variant: 'outline', label: 'no settlement' };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Response status:{' '}
        <Badge variant={statusBadgeVariant}>{networkFailed ? 'no response' : status}</Badge>
        <Badge variant={result.receipt.decision === 'allow' ? 'brand' : 'danger'}>
          {result.receipt.decision}
        </Badge>
        <Badge variant={settlementBadge.variant} className="gap-1">
          <Receipt className="size-3" />
          {settlementBadge.label}
        </Badge>
        {leash.redirected_to && (
          <Badge variant="outline" className="gap-1" title={leash.redirected_to}>
            ↳ redirected
          </Badge>
        )}
      </div>

      {networkFailed && (
        <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-fg-subtle">
          <p className="text-sm text-fg">Network error — request never reached the seller.</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-fg-muted">Reason</dt>
            <dd className="text-fg break-all">
              {result.failureReason ?? (
                <span className="text-fg-muted">
                  buyer-kit returned a Response.error() with no further detail
                </span>
              )}
            </dd>
          </dl>
          <p className="mt-2">Most common causes:</p>
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <li>The Privy popup was closed or rejected before signing.</li>
            <li>
              The configured facilitator (<InlineCode>{facilitatorDisplayHost()}</InlineCode>)
              returned an error or timed out while settling.
            </li>
            <li>
              The Solana RPC endpoint is unreachable / rate-limited (check{' '}
              <InlineCode>NEXT_PUBLIC_SOLANA_RPC</InlineCode>).
            </li>
            <li>
              The agent treasury ATA does not exist yet — open the agent profile and click{' '}
              <em>Provision stable ATAs</em>.
            </li>
          </ul>
        </div>
      )}

      {preferredAssetUnavailable && (
        <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-fg-subtle">
          <p className="text-sm text-fg">
            Seller doesn&apos;t accept your chosen settlement currency.
          </p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-fg-muted">Reason</dt>
            <dd className="text-fg break-all">{result.failureReason}</dd>
          </dl>
          <p className="mt-2">
            Switch the <strong>Pay with</strong> dropdown to a currency this link advertises in its{' '}
            <InlineCode>accepts[]</InlineCode>, then re-fire.
          </p>
        </div>
      )}

      {settlementFailed && !preferredAssetUnavailable && insufficient === 'balance' && (
        <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-fg-subtle">
          <p className="text-sm text-fg">Insufficient balance to complete payment.</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-fg-muted">Treasury holds</dt>
            <dd className="text-fg font-mono">
              {haveBalanceUsdc} {failurePanelCurrency}
            </dd>
            <dt className="text-fg-muted">Seller requires</dt>
            <dd className="text-fg font-mono">{needDisplay}</dd>
          </dl>
          <p className="mt-2">
            Top up the agent&apos;s {failurePanelCurrency} ATA, then click{' '}
            <strong>Fire request</strong> again.
          </p>
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <DevnetStableFundHint symbol={failurePanelCurrency} />
          </ul>
        </div>
      )}

      {settlementFailed && !preferredAssetUnavailable && insufficient === 'allowance' && (
        <div className="rounded-md border border-danger/40 bg-danger/5 p-3 text-xs text-fg-subtle">
          <p className="text-sm text-fg">Insufficient allowance to complete payment.</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-fg-muted">Executive approved for</dt>
            <dd className="text-fg font-mono">
              {haveAllowanceUsdc} {failurePanelCurrency}
            </dd>
            <dt className="text-fg-muted">Seller requires</dt>
            <dd className="text-fg font-mono">{needDisplay}</dd>
          </dl>
          <p className="mt-2">
            Open the agent profile and run <strong>Set allowance</strong> for {failurePanelCurrency}{' '}
            with a higher cap before re-firing.
          </p>
        </div>
      )}

      {settlementFailed && !preferredAssetUnavailable && insufficient == null && (
        <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-fg-subtle">
          <p className="text-sm text-fg">Seller returned 402 — payment did not settle.</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-fg-muted">Seller demanded</dt>
            <dd className="text-fg">{needDisplay}</dd>
            <dt className="text-fg-muted">Reason</dt>
            <dd className="text-fg">
              {result.failureReason ?? (
                <span className="text-fg-muted">
                  not reported by the seller (check Response body below)
                </span>
              )}
            </dd>
          </dl>
          <p className="mt-2">Most common fixes:</p>
          <ul className="ml-4 mt-1 list-disc space-y-0.5">
            <DevnetStableFundHint symbol={failurePanelCurrency} />
            <li>
              Top up a tiny bit of devnet SOL for ATA rent via{' '}
              <a
                href="https://faucet.solana.com"
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                faucet.solana.com
              </a>
              .
            </li>
          </ul>
        </div>
      )}
      {leash.redirected_to && (
        <a
          href={leash.redirected_to}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit font-mono"
          title={leash.redirected_to}
        >
          <ExternalLink className="size-3" /> Follow seller redirect →
        </a>
      )}

      {receiptTx ? (
        <a
          href={
            leash.tx_explorer?.trim() ||
            transactionExplorerUrl(result.receipt.price?.network ?? SOLANA_NETWORK, receiptTx)
          }
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-brand hover:underline w-fit font-mono"
          title={receiptTx}
        >
          <ExternalLink className="size-3" />
          View txn on explorer
          <span className="text-fg-subtle">
            ({receiptTx.slice(0, 8)}…{receiptTx.slice(-4)})
          </span>
        </a>
      ) : null}
      <FeeBreakdown price={result.receipt.price ?? result.quotedPrice ?? null} />
      <div>
        <Label className="mb-1 block">Leash response headers (X-Leash-*)</Label>
        <JsonViewer data={leash} maxHeight="10rem" />
      </div>
      <div>
        <Label className="mb-1 block">Receipt</Label>
        <JsonViewer data={result.receipt} maxHeight="22rem" />
      </div>
      <div>
        <Label className="mb-1 block">Response body</Label>
        <JsonViewer data={result.response.body} maxHeight="14rem" />
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-elev/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-fg-subtle">{label}</div>
      <div className="font-mono text-sm">{value}</div>
      {sub && <div className="text-[10px] text-fg-subtle">{sub}</div>}
    </div>
  );
}

/**
 * Per-call settlement breakdown: net / fee / gross.
 *
 * Renders nothing for vanilla x402 settlements (no `fee` field on the
 * receipt price). For Leash-flavoured settlements, surfaces the three
 * numbers side by side so the buyer can sanity-check what the
 * facilitator actually charged versus what the seller quoted.
 *
 * All Leash-supported stables share 6 decimals — see the comment on
 * `decimalToAtomicUsdc` above; if we ever add a non-6dp stable this
 * div needs to key off the receipt's resolved decimals.
 */
function FeeBreakdown({ price }: { price: ReceiptAny['price'] | null | undefined }) {
  if (!price) return null;
  if (!price.fee) return null;
  const currency = price.currency || 'tokens';
  const fmt = (atoms: string): string => {
    try {
      return (Number(BigInt(atoms)) / 1_000_000).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 6,
      });
    } catch {
      return atoms;
    }
  };
  const bpsLabel = typeof price.feeBps === 'number' ? ` (${(price.feeBps / 100).toFixed(2)}%)` : '';
  return (
    <div className="rounded-md border border-border bg-bg-elev/40 p-3 text-xs">
      <div className="mb-1.5 text-[10px] uppercase tracking-wider text-fg-subtle">
        Settlement breakdown
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 font-mono">
        <dt className="text-fg-muted">Net (seller)</dt>
        <dd className="text-fg">
          {fmt(price.amount)} {currency}
        </dd>
        <dt className="text-fg-muted">Protocol fee{bpsLabel}</dt>
        <dd className="text-amber-500">
          {fmt(price.fee)} {currency}
        </dd>
        {price.gross ? (
          <>
            <dt className="text-fg-muted">Gross (you signed)</dt>
            <dd className="text-fg">
              {fmt(price.gross)} {currency}
            </dd>
          </>
        ) : null}
        {price.feeAuthority ? (
          <>
            <dt className="text-fg-muted">Fee authority</dt>
            <dd className="break-all text-fg-subtle">{price.feeAuthority}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
