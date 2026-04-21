'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowLeft,
  Coins,
  Cog,
  FileText,
  Wallet as WalletIcon,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Loader2,
  RefreshCw,
  Copy,
} from 'lucide-react';
import Link from 'next/link';
import type { ReceiptV1 } from '@leash/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReceiptRow } from '@/components/receipt-row';
import { JsonViewer } from '@/components/json-viewer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/page-header';
import { jsonFetcher } from '@/lib/fetcher';
import { usePrivyUmi } from '@/lib/privy-umi';
import { delegateExecution, registerExecutive } from '@leash/registry-utils';

type FeedRes = {
  mint: string;
  receipts: ReceiptV1[];
  errors: Array<{ line: number; error: string }>;
};

export default function AgentPage() {
  const params = useParams<{ mint: string }>();
  const mint = decodeURIComponent(params.mint);
  const [registryUri, setRegistryUri] = React.useState('');

  const { data: feed } = useSWR<FeedRes>(mint ? `/api/receipts/${mint}` : null, jsonFetcher, {
    refreshInterval: 4000,
  });

  const { data: payTo } = useSWR<{ asset: string; payTo: string; error?: string }>(
    mint ? `/api/seller/payTo?asset=${mint}` : null,
    jsonFetcher,
  );

  const { data: identity } = useSWR<{
    asset: string;
    registered: boolean;
    treasury: string;
    registrationUri: string | null;
    owner: string | null;
    lifecycleChecks: { transfer?: unknown; update?: unknown; execute?: unknown } | null;
    error?: string;
    detail?: string;
  }>(mint ? `/api/agents/identity?asset=${mint}` : null, jsonFetcher);

  const { data: balance, mutate: refetchBalance } = useSWR<{
    asset: string;
    treasury: string;
    network: 'mainnet' | 'devnet';
    sol: number;
    lamports: string;
    tokens: Array<{
      mint: string;
      symbol: string | null;
      name: string | null;
      decimals: number;
      amount: string;
      ui: number;
      program: 'spl-token' | 'spl-token-2022';
      known: boolean;
    }>;
    error?: string;
  }>(mint ? `/api/agents/balance?asset=${mint}` : null, jsonFetcher, { refreshInterval: 8000 });

  const { umi: privyUmi, wallet: privyWallet } = usePrivyUmi();

  const { data: execStatus, mutate: refetchExec } = useSWR<{
    authority: string;
    registered: boolean;
    delegated: boolean | null;
    error?: string;
    detail?: string;
  }>(
    mint && privyWallet
      ? `/api/agents/executive?asset=${mint}&authority=${privyWallet.address}`
      : null,
    jsonFetcher,
  );

  const [execBusy, setExecBusy] = React.useState<null | 'register' | 'delegate'>(null);
  const [execError, setExecError] = React.useState<string | null>(null);
  const [execLastSig, setExecLastSig] = React.useState<string | null>(null);

  async function callExec(action: 'register' | 'delegate') {
    if (!privyUmi || !privyWallet) {
      setExecError('Connect a Solana wallet first.');
      return;
    }
    setExecBusy(action);
    setExecError(null);
    setExecLastSig(null);
    try {
      const res =
        action === 'register'
          ? await registerExecutive(privyUmi)
          : await delegateExecution(privyUmi, {
              agentAsset: mint,
              executiveAuthority: privyWallet.address,
            });
      setExecLastSig(res.signature);
      await refetchExec();
    } catch (err) {
      setExecError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecBusy(null);
    }
  }

  const { data: registration, mutate: refetchReg } = useSWR<{
    uri: string;
    document: unknown;
    source: string;
    error?: string;
  }>(
    registryUri ? `/api/registry/resolve?uri=${encodeURIComponent(registryUri)}` : null,
    jsonFetcher,
  );

  React.useEffect(() => {
    if (identity?.registrationUri && !registryUri) {
      setRegistryUri(identity.registrationUri);
    }
  }, [identity?.registrationUri, registryUri]);

  const earnCount = feed?.receipts.filter((r) => r.kind === 'earn').length ?? 0;
  const spendCount = feed?.receipts.filter((r) => r.kind === 'spend').length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg w-fit"
      >
        <ArrowLeft className="size-3" /> All agents
      </Link>
      <PageHeader
        eyebrow="Agent profile"
        title={<span className="font-mono text-xl break-all">{mint}</span>}
        description="Identity, treasury, capabilities, and the on-runner receipt feed for this Core asset."
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href={`/a/${mint}/receipts.jsonl`} target="_blank" rel="noreferrer">
              receipts.jsonl
            </a>
          </Button>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              {identity?.registered ? (
                <ShieldCheck className="size-3.5 text-success" />
              ) : (
                <ShieldAlert className="size-3.5 text-warning" />
              )}{' '}
              Identity
            </CardDescription>
            <CardTitle className="text-sm">
              {identity == null
                ? 'checking…'
                : identity.error
                  ? identity.error
                  : identity.registered
                    ? 'Registered (MIP-104)'
                    : 'Not registered'}
            </CardTitle>
            {identity?.owner && (
              <code className="font-mono text-[10px] text-fg-subtle break-all">
                owner: {identity.owner}
              </code>
            )}
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <WalletIcon className="size-3.5" /> Treasury value
            </CardDescription>
            <CardTitle className="text-sm">
              {balance == null
                ? 'loading…'
                : balance.error
                  ? balance.error
                  : `${balance.sol.toFixed(4)} SOL + ${balance.tokens.filter((t) => t.ui > 0).length} tokens`}
            </CardTitle>
            <span className="text-[11px] text-fg-subtle">See full breakdown ↓</span>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Coins className="size-3.5" /> Earn / Spend
            </CardDescription>
            <CardTitle className="flex items-center gap-2">
              <Badge variant="success">earn {earnCount}</Badge>
              <Badge variant="brand">spend {spendCount}</Badge>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <Cog className="size-3.5" /> Network
            </CardDescription>
            <CardTitle className="text-sm">
              {balance?.network ? `Solana ${balance.network}` : 'Solana devnet'}
            </CardTitle>
          </CardHeader>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Coins className="size-4 text-brand" /> Treasury balances
            </CardTitle>
            <CardDescription className="mt-1">
              SOL + SPL token holdings of the agent's{' '}
              <code className="font-mono text-xs">Asset Signer PDA</code>. Stables (USDC / USDT /
              USDG) are pinned even at zero so you can spot when funding lands. Auto-refresh every
              8s.
            </CardDescription>
            {payTo?.payTo && (
              <div className="mt-2 flex items-center gap-2">
                <code className="font-mono text-[10px] text-fg-subtle break-all">
                  {payTo.payTo}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => navigator.clipboard.writeText(payTo.payTo)}
                  title="Copy treasury address"
                >
                  <Copy className="size-3" />
                </Button>
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetchBalance()} title="Refresh">
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {balance?.error && <p className="text-sm text-danger">{balance.error}</p>}
          {!balance && <p className="text-sm text-fg-muted">Loading…</p>}

          {balance && !balance.error && (
            <ul className="flex flex-col divide-y divide-border/60">
              <li className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-[10px] font-bold text-brand-strong">
                    SOL
                  </span>
                  <span className="text-sm font-medium">Solana</span>
                </div>
                <code className="font-mono text-[11px] text-fg-subtle">
                  native · {balance.lamports} lamports
                </code>
                <span className="text-sm font-mono tabular-nums">
                  {balance.sol.toLocaleString(undefined, {
                    minimumFractionDigits: 4,
                    maximumFractionDigits: 9,
                  })}
                </span>
              </li>
              {balance.tokens.length === 0 ? (
                <li className="py-3 text-center text-xs text-fg-subtle">No SPL tokens detected.</li>
              ) : (
                balance.tokens.map((t) => {
                  const display = t.symbol ?? `${t.mint.slice(0, 4)}…${t.mint.slice(-4)}`;
                  const subtitle = t.known
                    ? (t.name ?? '')
                    : `unknown mint · ${t.mint.slice(0, 8)}…`;
                  return (
                    <li
                      key={`${t.mint}-${t.program}`}
                      className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 py-2.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={
                            'grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ' +
                            (t.known
                              ? 'bg-brand-soft text-brand-strong'
                              : 'bg-bg-elev-2 text-fg-muted')
                          }
                        >
                          {display.slice(0, 4).toUpperCase()}
                        </span>
                        <div className="flex flex-col min-w-0">
                          <span className="text-sm font-medium truncate">{display}</span>
                          {t.program === 'spl-token-2022' && (
                            <Badge variant="outline" className="self-start mt-0.5">
                              Token-2022
                            </Badge>
                          )}
                        </div>
                      </div>
                      <code className="font-mono text-[11px] text-fg-subtle truncate">
                        {subtitle}
                      </code>
                      <span
                        className={
                          'text-sm font-mono tabular-nums ' + (t.ui > 0 ? '' : 'text-fg-subtle')
                        }
                      >
                        {t.ui.toLocaleString(undefined, {
                          minimumFractionDigits: Math.min(2, t.decimals),
                          maximumFractionDigits: t.decimals,
                        })}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="receipts">
        <TabsList>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="identity">Identity (registration)</TabsTrigger>
          <TabsTrigger value="executive">Execute (delegation)</TabsTrigger>
        </TabsList>

        <TabsContent value="receipts">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-brand" /> Receipt feed
              </CardTitle>
              <CardDescription>
                Tail of the runner's <code className="font-mono">receipts.jsonl</code> for this
                agent. Auto-refreshing every 4s.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {!feed && <p className="text-sm text-fg-muted">Loading…</p>}
              {feed && feed.receipts.length === 0 && (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
                  No receipts yet for this agent.
                </div>
              )}
              {feed?.receipts
                .slice()
                .reverse()
                .map((r) => (
                  <ReceiptRow key={r.receipt_hash} receipt={r} />
                ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="identity">
          <Card>
            <CardHeader>
              <CardTitle>Registration document</CardTitle>
              <CardDescription>
                Paste the agent's published registration URI (Pinata / IPFS / HTTPS). We fetch and
                validate it against <code className="font-mono">RegistrationV1</code> via{' '}
                <code className="font-mono">@leash/registry-utils</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="uri">Registration URI</Label>
                <div className="flex gap-2">
                  <Input
                    id="uri"
                    value={registryUri}
                    onChange={(e) => setRegistryUri(e.target.value)}
                    placeholder="https://gateway.pinata.cloud/ipfs/..."
                  />
                  <Button variant="secondary" onClick={() => refetchReg()}>
                    Resolve
                  </Button>
                </div>
              </div>
              {registration?.error ? (
                <p className="text-sm text-danger">{registration.error}</p>
              ) : registration?.document ? (
                <JsonViewer data={registration.document} maxHeight="32rem" />
              ) : (
                <p className="text-xs text-fg-subtle">No document loaded yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="executive">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-brand" /> Executive delegation
              </CardTitle>
              <CardDescription>
                Per the Metaplex docs, an asset's built-in wallet (Asset Signer PDA) can only act
                via Core's <code className="font-mono">Execute</code> hook. The asset owner
                delegates execution to a registered <strong>executive</strong>; that executive's
                wallet then signs <code className="font-mono">Execute</code> instructions on the
                agent's behalf. Both calls below are signed by{' '}
                <strong>your connected Privy wallet</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!privyWallet ? (
                <p className="text-sm text-warning">
                  Connect a Solana wallet (top-right) to register / delegate execution.
                </p>
              ) : execStatus?.error ? (
                <p className="text-sm text-danger">
                  {execStatus.detail
                    ? `${execStatus.error}: ${execStatus.detail}`
                    : execStatus.error}
                </p>
              ) : execStatus == null ? (
                <p className="text-xs text-fg-muted">checking…</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-border bg-bg-elev/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-fg-subtle">
                        Executive profile
                      </span>
                      <Badge variant={execStatus.registered ? 'success' : 'warning'}>
                        {execStatus.registered ? 'registered' : 'not registered'}
                      </Badge>
                    </div>
                    <code className="mt-1 block font-mono text-[10px] text-fg-muted break-all">
                      {execStatus.authority}
                    </code>
                    <Button
                      className="mt-3 w-full"
                      variant="secondary"
                      disabled={execStatus.registered || execBusy === 'register'}
                      onClick={() => callExec('register')}
                    >
                      {execBusy === 'register' && <Loader2 className="size-4 animate-spin" />}{' '}
                      registerExecutiveV1
                    </Button>
                  </div>

                  <div className="rounded-md border border-border bg-bg-elev/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider text-fg-subtle">
                        Delegation for this agent
                      </span>
                      <Badge variant={execStatus.delegated ? 'success' : 'warning'}>
                        {execStatus.delegated ? 'delegated' : 'not delegated'}
                      </Badge>
                    </div>
                    <span className="mt-1 block text-[11px] text-fg-subtle">
                      Your wallet must be the asset owner to delegate execution.
                    </span>
                    <Button
                      className="mt-3 w-full"
                      variant="secondary"
                      disabled={
                        !execStatus.registered ||
                        execStatus.delegated === true ||
                        execBusy === 'delegate'
                      }
                      onClick={() => callExec('delegate')}
                    >
                      {execBusy === 'delegate' && <Loader2 className="size-4 animate-spin" />}{' '}
                      delegateExecutionV1
                    </Button>
                  </div>
                </div>
              )}
              {execError && <p className="text-sm text-danger">{execError}</p>}
              {execLastSig && (
                <div className="rounded-md border border-success/40 bg-success/10 p-3 text-xs">
                  <span className="font-medium text-success">Tx confirmed:</span>{' '}
                  <code className="font-mono break-all">{execLastSig}</code>
                </div>
              )}
              <p className="text-xs text-fg-subtle leading-relaxed">
                What's <em>not</em> here yet: composing the actual{' '}
                <code className="font-mono">mpl-core Execute</code> instruction (e.g. SPL{' '}
                <code className="font-mono">transferChecked</code> from the treasury). That ships in
                the next patch as <code className="font-mono">@leash/core/treasury/withdraw</code>.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
