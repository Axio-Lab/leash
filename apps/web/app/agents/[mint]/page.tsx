'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Coins,
  Cog,
  ExternalLink,
  FileText,
  Wallet as WalletIcon,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Loader2,
  RefreshCw,
  Copy,
  PlusCircle,
  Send,
  ShieldOff,
  Sparkles,
  TriangleAlert,
  Wallet,
} from 'lucide-react';
import Link from 'next/link';
import type { ReceiptV1 } from '@leash/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ReceiptRow } from '@/components/receipt-row';
import { Pager, usePagedItems } from '@/components/ui/pager';
import { JsonViewer } from '@/components/json-viewer';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/page-header';
import { jsonFetcher } from '@/lib/fetcher';
import { usePrivyUmi } from '@/lib/privy-umi';
import {
  delegateExecution,
  registerExecutive,
  getSpendDelegation,
  setSpendDelegation,
  revokeSpendDelegation,
  provisionTreasuryAtas,
  withdrawTreasury,
  withdrawTreasuryAll,
  type ProvisionTreasuryAtasResult,
  type SpendDelegationStatus,
} from '@leash/registry-utils';
import { transactionExplorerUrl } from '@/lib/solscan';
import { loadAgent, saveAgent, type StoredAgent } from '@/lib/agent-storage';
import { useToast } from '@/components/ui/toast';

const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function defaultUsdcMint(network: 'mainnet' | 'devnet' | undefined): {
  mint: string;
  label: string;
} {
  return network === 'mainnet'
    ? { mint: USDC_MAINNET, label: 'USDC' }
    : { mint: USDC_DEVNET, label: 'USDC (devnet)' };
}

/**
 * Cheap client-side guard for the withdraw destination input — verifies
 * the string looks like a base58-encoded Solana address (32–44 chars,
 * base58 alphabet). Real validation happens on chain when the tx
 * simulates, but this stops typos from triggering wallet popups.
 */
function isLikelySolanaAddress(input: string): boolean {
  if (input.length < 32 || input.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(input);
}

type FeedRes = {
  mint: string;
  receipts: ReceiptV1[];
  errors: Array<{ line: number; error: string }>;
};

export default function AgentPage() {
  const params = useParams<{ mint: string }>();
  const mint = decodeURIComponent(params.mint);
  const [registryUri, setRegistryUri] = React.useState('');
  const [localRecord, setLocalRecord] = React.useState<StoredAgent | null>(null);
  React.useEffect(() => {
    if (mint) setLocalRecord(loadAgent(mint));
  }, [mint]);

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

  // ---- Spend allowance (treasury → executive SPL Approve) ----
  const toast = useToast();
  const usdcInfo = defaultUsdcMint(balance?.network);
  const [delegation, setDelegation] = React.useState<SpendDelegationStatus | null>(null);
  const [delegationLoading, setDelegationLoading] = React.useState(false);
  const [delegationError, setDelegationError] = React.useState<string | null>(null);
  const [allowanceDraft, setAllowanceDraft] = React.useState('5.00');
  const [allowanceBusy, setAllowanceBusy] = React.useState<'set' | 'revoke' | null>(null);
  const [allowanceLastSig, setAllowanceLastSig] = React.useState<string | null>(null);
  const [provisionBusy, setProvisionBusy] = React.useState(false);
  const [provisionResult, setProvisionResult] = React.useState<ProvisionTreasuryAtasResult | null>(
    null,
  );
  const [provisionError, setProvisionError] = React.useState<string | null>(null);

  const refreshDelegation = React.useCallback(async (): Promise<SpendDelegationStatus | null> => {
    if (!privyUmi || !mint) return null;
    setDelegationLoading(true);
    setDelegationError(null);
    try {
      const status = await getSpendDelegation(privyUmi, {
        agentAsset: mint,
        mint: usdcInfo.mint,
      });
      setDelegation(status);
      return status;
    } catch (err) {
      setDelegationError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setDelegationLoading(false);
    }
  }, [privyUmi, mint, usdcInfo.mint]);

  /**
   * Re-read the delegation up to `maxAttempts` times with exponential
   * backoff until either the on-chain `delegate` matches `expectedDelegate`
   * AND `delegatedAmount` matches `expectedAmount`, or we time out.
   *
   * Devnet RPCs occasionally return slightly stale data immediately after
   * `sendAndConfirm` returns. The polling loop ensures the "Remaining
   * allowance" tile reflects the value the user just approved instead of
   * a brief flash of the previous (or zero) state.
   */
  const confirmDelegationMatches = React.useCallback(
    async (expected: { delegate: string | null; amount: bigint }) => {
      const delays = [800, 1200, 1800, 2500];
      for (const wait of delays) {
        const status = await refreshDelegation();
        if (!status) return;
        const delegateMatches = (status.delegate ?? null) === expected.delegate;
        const amountMatches = status.delegatedAmount === expected.amount;
        if (delegateMatches && amountMatches) return;
        await new Promise((r) => window.setTimeout(r, wait));
      }
    },
    [refreshDelegation],
  );

  React.useEffect(() => {
    void refreshDelegation();
  }, [refreshDelegation]);

  async function handleSetAllowance() {
    if (!privyUmi || !privyWallet) {
      toast.error('Connect a wallet', 'You need a Solana wallet to approve a delegation.');
      return;
    }
    const decimal = Number(allowanceDraft);
    if (!Number.isFinite(decimal) || decimal <= 0) {
      toast.error('Invalid amount', 'Enter a positive USDC amount.');
      return;
    }
    setAllowanceBusy('set');
    setAllowanceLastSig(null);
    try {
      const atomic = BigInt(Math.round(decimal * 1_000_000));
      const res = await setSpendDelegation(privyUmi, {
        agentAsset: mint,
        mint: usdcInfo.mint,
        executive: privyWallet.address,
        amount: atomic,
      });
      setAllowanceLastSig(res.signature);
      saveAgent({
        mint,
        label: localRecord?.label,
        network:
          localRecord?.network ??
          (balance?.network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet'),
        owner: localRecord?.owner ?? privyWallet.address,
        rules: localRecord?.rules ?? null,
        sourceTokenAccount: res.sourceTokenAccount,
        fundingMint: usdcInfo.mint,
        treasury: res.treasury,
        allowanceCap: atomic.toString(),
        allowanceUpdatedAt: new Date().toISOString(),
      });
      setLocalRecord(loadAgent(mint));

      // Optimistic update — sendAndConfirm already resolved, so we know
      // the delegation lives on-chain. Reflect it in the UI immediately
      // instead of waiting for the (sometimes laggy) RPC re-read.
      setDelegation((prev) => ({
        treasury: res.treasury,
        sourceTokenAccount: res.sourceTokenAccount,
        sourceExists: true,
        balance: prev?.balance ?? 0n,
        delegate: privyWallet.address,
        delegatedAmount: atomic,
      }));

      toast.success('Allowance updated', `${allowanceDraft} ${usdcInfo.label} approved.`);

      // Belt-and-braces: re-read on-chain a few times so we self-correct
      // if the RPC lagged the first time around.
      await confirmDelegationMatches({ delegate: privyWallet.address, amount: atomic });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Approve failed', msg);
    } finally {
      setAllowanceBusy(null);
    }
  }

  /**
   * Idempotently create the curated stable ATAs (USDC on devnet; USDC + USDT
   * on mainnet) for this agent's treasury. Useful for legacy agents minted
   * before automatic provisioning shipped, or to recover after a failed
   * post-mint provisioning step.
   */
  async function handleProvisionAtas() {
    if (!privyUmi || !privyWallet) {
      toast.error('Connect a wallet', 'You need a Solana wallet to provision treasury ATAs.');
      return;
    }
    const network: 'solana-mainnet' | 'solana-devnet' =
      balance?.network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet';
    setProvisionBusy(true);
    setProvisionError(null);
    try {
      const res = await provisionTreasuryAtas(privyUmi, {
        agentAsset: mint,
        network,
      });
      setProvisionResult(res);
      const created = res.atas.filter((a) => a.created);
      if (created.length === 0) {
        toast.info('Already provisioned', 'Every supported stable ATA exists for this treasury.');
      } else {
        toast.success(
          'Treasury ATAs provisioned',
          `${created.map((a) => a.symbol ?? a.mint.slice(0, 4)).join(', ')} ready to receive funds.`,
        );
      }
      await refreshDelegation();
      await refetchBalance();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProvisionError(msg);
      toast.error('Provisioning failed', msg);
    } finally {
      setProvisionBusy(false);
    }
  }

  async function handleRevokeAllowance() {
    if (!privyUmi || !privyWallet) return;
    setAllowanceBusy('revoke');
    setAllowanceLastSig(null);
    try {
      const res = await revokeSpendDelegation(privyUmi, {
        agentAsset: mint,
        mint: usdcInfo.mint,
      });
      setAllowanceLastSig(res.signature);
      saveAgent({
        mint,
        label: localRecord?.label,
        network:
          localRecord?.network ??
          (balance?.network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet'),
        owner: localRecord?.owner ?? privyWallet.address,
        rules: localRecord?.rules ?? null,
        sourceTokenAccount: res.sourceTokenAccount,
        fundingMint: usdcInfo.mint,
        treasury: res.treasury,
        allowanceCap: '0',
        allowanceUpdatedAt: new Date().toISOString(),
      });
      setLocalRecord(loadAgent(mint));

      // Optimistic clear so the "no delegate" state shows up immediately.
      setDelegation((prev) => ({
        treasury: res.treasury,
        sourceTokenAccount: res.sourceTokenAccount,
        sourceExists: true,
        balance: prev?.balance ?? 0n,
        delegate: null,
        delegatedAmount: 0n,
      }));

      toast.info('Delegation revoked', 'Executive can no longer move treasury funds.');
      await confirmDelegationMatches({ delegate: null, amount: 0n });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Revoke failed', msg);
    } finally {
      setAllowanceBusy(null);
    }
  }

  // ---- Withdraw treasury (owner → arbitrary destination) ----
  const [withdrawAmountDraft, setWithdrawAmountDraft] = React.useState('');
  const [withdrawDestinationDraft, setWithdrawDestinationDraft] = React.useState('');
  const [withdrawBusy, setWithdrawBusy] = React.useState<null | 'amount' | 'all'>(null);
  const [withdrawLastSig, setWithdrawLastSig] = React.useState<string | null>(null);
  const [withdrawDestinationConfirmed, setWithdrawDestinationConfirmed] = React.useState(false);

  // Default the destination to the connected (owner) wallet whenever it
  // changes. The user can still type a different address — we surface a
  // warning + require an explicit confirm box in that case.
  React.useEffect(() => {
    if (privyWallet?.address && withdrawDestinationDraft === '') {
      setWithdrawDestinationDraft(privyWallet.address);
    }
  }, [privyWallet?.address, withdrawDestinationDraft]);

  const isWithdrawDestinationOwner =
    !!privyWallet?.address && withdrawDestinationDraft.trim() === privyWallet.address;
  const isWithdrawDestinationValid = isLikelySolanaAddress(withdrawDestinationDraft.trim());
  const requiresWithdrawConfirmation = isWithdrawDestinationValid && !isWithdrawDestinationOwner;

  async function handleWithdraw(mode: 'amount' | 'all') {
    if (!privyUmi || !privyWallet) {
      toast.error('Connect a wallet', 'You need a Solana wallet to withdraw.');
      return;
    }
    const destination = withdrawDestinationDraft.trim();
    if (!isLikelySolanaAddress(destination)) {
      toast.error('Invalid destination', 'Paste a valid Solana wallet address.');
      return;
    }
    if (requiresWithdrawConfirmation && !withdrawDestinationConfirmed) {
      toast.error(
        'Confirm destination',
        'You\u2019re sending to an address that is not your owner wallet. Tick the confirmation box first.',
      );
      return;
    }
    setWithdrawBusy(mode);
    setWithdrawLastSig(null);
    try {
      let res;
      if (mode === 'all') {
        res = await withdrawTreasuryAll(privyUmi, {
          agentAsset: mint,
          mint: usdcInfo.mint,
          destination,
        });
        if (!res) {
          toast.info('Nothing to withdraw', 'Treasury balance is 0.');
          return;
        }
      } else {
        const decimal = Number(withdrawAmountDraft);
        if (!Number.isFinite(decimal) || decimal <= 0) {
          toast.error('Invalid amount', `Enter a positive ${usdcInfo.label} amount.`);
          return;
        }
        const atomic = BigInt(Math.round(decimal * 1_000_000));
        res = await withdrawTreasury(privyUmi, {
          agentAsset: mint,
          mint: usdcInfo.mint,
          destination,
          amount: atomic,
        });
      }
      setWithdrawLastSig(res.signature);
      const sentUsdc = Number(res.amount) / 1_000_000;
      toast.success(
        'Withdrawal confirmed',
        `${sentUsdc.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        })} ${usdcInfo.label} sent to ${destination.slice(0, 8)}\u2026${destination.slice(-4)}.`,
      );
      // Surface the new (lower) treasury balance immediately rather than
      // waiting on the next 8s poll.
      await Promise.all([refreshDelegation(), refetchBalance()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Withdraw failed', msg);
    } finally {
      setWithdrawBusy(null);
    }
  }

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
      const authority = privyWallet.address;
      await refetchExec(
        (prev) => {
          if (action === 'register') {
            return {
              authority,
              registered: true,
              delegated: prev?.delegated ?? null,
              error: undefined,
              detail: undefined,
            };
          }
          return {
            authority,
            registered: prev?.registered ?? true,
            delegated: true,
            error: undefined,
            detail: undefined,
          };
        },
        { revalidate: false },
      );
      window.setTimeout(() => {
        void refetchExec();
      }, 4000);
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
    valid?: boolean;
    schemaError?: string | null;
    error?: string;
    detail?: string;
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
  const sortedReceipts = React.useMemo(
    () => (feed?.receipts ?? []).slice().reverse(),
    [feed?.receipts],
  );
  const receiptsPaged = usePagedItems(sortedReceipts, 5);

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
                  : (() => {
                      // The "value" of an agent treasury is the spendable
                      // stablecoin balance (USDC primarily). SOL only matters
                      // for ATA rent so we show it as a secondary line. We
                      // explicitly avoid the previous "5.0000 SOL + N tokens"
                      // copy which conflated rent SOL with spendable balance.
                      const stables = balance.tokens.filter(
                        (t) =>
                          t.symbol === 'USDC' ||
                          t.symbol === 'USDT' ||
                          t.symbol === 'USDG' ||
                          t.symbol === 'PYUSD',
                      );
                      const usdcLike = stables.reduce((acc, t) => acc + t.ui, 0);
                      const otherTokens = balance.tokens.filter(
                        (t) => !stables.includes(t) && t.ui > 0,
                      );
                      const stablePart =
                        stables.length > 0
                          ? `${usdcLike.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })} ${stables[0]?.symbol ?? 'USDC'}`
                          : '0.00 USDC';
                      const extra = otherTokens.length > 0 ? ` · +${otherTokens.length} other` : '';
                      return `${stablePart}${extra}`;
                    })()}
            </CardTitle>
            <span className="text-[11px] text-fg-subtle">
              {balance == null ? 'See full breakdown ↓' : `+ ${balance.sol.toFixed(0)} SOL`}
            </span>
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
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleProvisionAtas}
              disabled={provisionBusy || !privyWallet}
              title="Idempotently create the agent treasury's USDC / USDT ATAs"
            >
              {provisionBusy && <Loader2 className="size-3.5 animate-spin" />}
              Provision stable ATAs
            </Button>
            <Button variant="ghost" size="icon" onClick={() => refetchBalance()} title="Refresh">
              <RefreshCw className="size-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {balance?.error && <p className="text-sm text-danger">{balance.error}</p>}
          {!balance && <p className="text-sm text-fg-muted">Loading…</p>}
          {provisionError && (
            <div className="rounded-md border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
              {provisionError}
            </div>
          )}
          {provisionResult && provisionResult.atas.length > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-elev/40 p-2 text-[11px]">
              <span className="uppercase tracking-wider text-fg-subtle">Treasury ATAs</span>
              {provisionResult.atas.map((a) => (
                <div key={a.address} className="flex items-center justify-between gap-2">
                  <Badge variant={a.created ? 'brand' : 'outline'}>
                    {a.symbol ?? a.mint.slice(0, 4)}
                    {a.created ? ' · created' : ' · existed'}
                  </Badge>
                  <code className="font-mono break-all text-fg-muted">{a.address}</code>
                </div>
              ))}
            </div>
          )}

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

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-brand" /> Spend allowance ({usdcInfo.label})
            </CardTitle>
            <CardDescription>
              How much of the agent treasury your wallet (the executive) is allowed to move per x402
              call. Backed by an SPL <code className="font-mono text-xs">Approve</code> on the
              agent&apos;s USDC ATA — funds physically live on the agent treasury PDA, the executive
              just signs. Re-approve to top up; revoke to lock everything down.
            </CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={refreshDelegation} title="Refresh">
            <RefreshCw className="size-4" />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!privyWallet ? (
            <p className="text-sm text-warning">
              Connect a Solana wallet (top-right) to view or change the delegation.
            </p>
          ) : delegationLoading && !delegation ? (
            <p className="text-xs text-fg-muted">Reading on-chain delegation…</p>
          ) : delegationError ? (
            <p className="text-sm text-danger">{delegationError}</p>
          ) : delegation ? (
            (() => {
              const remaining = delegation.delegatedAmount;
              const treasuryBalance = delegation.balance;
              const cap = computeCap(localRecord?.allowanceCap, remaining);
              const used = cap > remaining ? cap - remaining : 0n;
              const usedPct = cap > 0n ? Math.min(100, Number((used * 10000n) / cap) / 100) : 0;
              const remainingUsdc = Number(remaining) / 1_000_000;
              const balanceUsdc = Number(treasuryBalance) / 1_000_000;
              const capUsdc = Number(cap) / 1_000_000;
              const usedUsdc = Number(used) / 1_000_000;
              const effectiveSpend = Math.min(remainingUsdc, balanceUsdc);
              const spotPriceUsdc = 0.005;
              const callsLeft = spotPriceUsdc > 0 ? Math.floor(effectiveSpend / spotPriceUsdc) : 0;
              const isPolling = allowanceBusy == null && delegationLoading && delegation != null;

              return (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border border-border bg-bg-elev/40 p-3">
                      <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                        Treasury balance
                      </span>
                      <div className="font-mono text-sm">
                        {balanceUsdc.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 6,
                        })}{' '}
                        {usdcInfo.label}
                      </div>
                      <span className="text-[10px] text-fg-subtle">
                        {delegation.sourceExists ? 'ATA initialised' : 'ATA not yet created'}
                      </span>
                    </div>
                    <div className="rounded-md border border-border bg-bg-elev/40 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                          Remaining allowance
                        </span>
                        {isPolling && (
                          <Loader2
                            className="size-3 animate-spin text-fg-subtle"
                            aria-label="Confirming on-chain"
                          />
                        )}
                      </div>
                      <div className="font-mono text-sm">
                        {remainingUsdc.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 6,
                        })}{' '}
                        {usdcInfo.label}
                      </div>
                      <span className="text-[10px] text-fg-subtle">
                        {delegation.delegate
                          ? `delegate: ${delegation.delegate.slice(0, 8)}…${delegation.delegate.slice(-4)}`
                          : 'no delegate'}
                      </span>
                    </div>
                    <div className="rounded-md border border-border bg-bg-elev/40 p-3">
                      <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                        Source ATA
                      </span>
                      <code className="block font-mono text-[10px] break-all text-fg-muted">
                        {delegation.sourceTokenAccount}
                      </code>
                      <span className="text-[10px] text-fg-subtle">
                        Buyer-kit uses this as <code className="font-mono">sourceTokenAccount</code>
                        .
                      </span>
                    </div>
                  </div>

                  {/* Cap-vs-used progress bar. We compute `cap` as max(stored
                      allowanceCap, current delegatedAmount) so externally
                      re-approved delegations still render meaningfully. */}
                  {cap > 0n && (
                    <div className="rounded-md border border-border bg-bg-elev/40 p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="uppercase tracking-wider text-fg-subtle">
                          Allowance usage
                        </span>
                        <span className="font-mono text-fg-muted">
                          {usedUsdc.toFixed(usedUsdc < 1 ? 4 : 2)} /{' '}
                          {capUsdc.toFixed(capUsdc < 1 ? 4 : 2)} {usdcInfo.label} used
                        </span>
                      </div>
                      <div
                        className="h-2 w-full rounded-full bg-bg-elev-2 overflow-hidden"
                        role="progressbar"
                        aria-valuenow={usedPct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className={
                            'h-full transition-all ' +
                            (usedPct > 80 ? 'bg-warning' : usedPct > 50 ? 'bg-brand' : 'bg-success')
                          }
                          style={{ width: `${usedPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-fg-subtle">
                        {remainingUsdc <= 0
                          ? 'Cap exhausted — re-approve below to keep going.'
                          : `≈ ${callsLeft.toLocaleString()} more calls @ $${spotPriceUsdc.toFixed(3)} (or ${Math.floor(effectiveSpend / 0.05).toLocaleString()} @ $0.05) before you re-approve.`}
                      </span>
                    </div>
                  )}

                  {/* What's next — actionable hints based on current state. */}
                  <NextSteps
                    delegation={delegation}
                    balanceUsdc={balanceUsdc}
                    remainingUsdc={remainingUsdc}
                    capUsdc={capUsdc}
                    mint={mint}
                    usdcLabel={usdcInfo.label}
                  />

                  <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="allowance" className="text-xs">
                        New allowance ({usdcInfo.label})
                      </Label>
                      <Input
                        id="allowance"
                        value={allowanceDraft}
                        onChange={(e) => setAllowanceDraft(e.target.value)}
                        inputMode="decimal"
                        placeholder="5.00"
                        className="font-mono"
                      />
                      <span className="text-[11px] text-fg-subtle">
                        Sets the cap (overwrites any existing one). Top up by re-approving.
                      </span>
                    </div>
                    <Button onClick={handleSetAllowance} disabled={allowanceBusy != null}>
                      {allowanceBusy === 'set' && <Loader2 className="size-4 animate-spin" />}
                      Set allowance
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleRevokeAllowance}
                      disabled={allowanceBusy != null || !delegation.delegate}
                    >
                      {allowanceBusy === 'revoke' && <Loader2 className="size-4 animate-spin" />}
                      Revoke
                    </Button>
                  </div>

                  {delegation.sourceExists && delegation.balance === 0n && (
                    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-[11px] text-warning leading-relaxed">
                      Treasury holds <strong>0 {usdcInfo.label}</strong>. Send some to{' '}
                      <code className="font-mono">{delegation.sourceTokenAccount}</code> (or to the
                      treasury PDA <code className="font-mono">{delegation.treasury}</code> — the
                      ATA is auto-created on first deposit). Devnet faucet:{' '}
                      <a
                        href="https://faucet.circle.com/"
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        faucet.circle.com
                      </a>
                      .
                    </div>
                  )}

                  {allowanceLastSig && (
                    <div className="flex flex-col gap-1.5 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
                      <span className="font-medium text-success">Tx confirmed</span>
                      <a
                        href={transactionExplorerUrl(
                          balance?.network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet',
                          allowanceLastSig,
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-brand hover:underline break-all"
                      >
                        <ExternalLink className="size-3 shrink-0" />
                        <span className="break-all">{allowanceLastSig}</span>
                      </a>
                    </div>
                  )}
                </>
              );
            })()
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownToLine className="size-4 text-brand" /> Withdraw treasury ({usdcInfo.label})
          </CardTitle>
          <CardDescription>
            Move {usdcInfo.label} out of the agent treasury. The connected wallet (the agent
            <strong> owner</strong>) signs an{' '}
            <code className="font-mono text-xs">mpl-core::Execute</code> instruction that CPI-signs
            an SPL <code className="font-mono text-xs">TransferChecked</code> on the treasury PDA.
            The destination ATA is created automatically if it doesn&apos;t exist.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!privyWallet ? (
            <p className="text-sm text-warning">
              Connect a Solana wallet (top-right) to withdraw from this treasury.
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="withdraw-destination" className="text-xs">
                    Destination wallet
                  </Label>
                  <Input
                    id="withdraw-destination"
                    value={withdrawDestinationDraft}
                    onChange={(e) => {
                      setWithdrawDestinationDraft(e.target.value);
                      setWithdrawDestinationConfirmed(false);
                    }}
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder={privyWallet.address}
                  />
                  <span className="text-[11px] text-fg-subtle">
                    Defaults to your owner wallet. We send to this address&apos;s{' '}
                    <code className="font-mono">{usdcInfo.label}</code> ATA — created on the fly if
                    missing.
                  </span>
                </div>
                {isWithdrawDestinationOwner ? (
                  <Badge variant="success" className="gap-1 self-start md:self-end">
                    <ShieldCheck className="size-3" /> owner
                  </Badge>
                ) : isWithdrawDestinationValid ? (
                  <Badge variant="warning" className="gap-1 self-start md:self-end">
                    <TriangleAlert className="size-3" /> external
                  </Badge>
                ) : null}
              </div>

              {requiresWithdrawConfirmation && (
                <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-[12px] text-warning leading-relaxed">
                  <TriangleAlert className="size-4 shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-1.5">
                    <span>
                      You&apos;re withdrawing to an address that is <strong>not</strong> your owner
                      wallet. Funds will leave this agent permanently. Double-check the address
                      character-by-character before confirming.
                    </span>
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={withdrawDestinationConfirmed}
                        onChange={(e) => setWithdrawDestinationConfirmed(e.target.checked)}
                      />
                      <span>I&apos;ve verified this address.</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-[1fr_auto_auto] md:items-end">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="withdraw-amount" className="text-xs">
                    Amount ({usdcInfo.label})
                  </Label>
                  <Input
                    id="withdraw-amount"
                    value={withdrawAmountDraft}
                    onChange={(e) => setWithdrawAmountDraft(e.target.value)}
                    inputMode="decimal"
                    placeholder="1.00"
                    className="font-mono"
                  />
                  <span className="text-[11px] text-fg-subtle">
                    Treasury balance:{' '}
                    <strong className="text-fg-muted">
                      {delegation
                        ? (Number(delegation.balance) / 1_000_000).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 6,
                          })
                        : '—'}{' '}
                      {usdcInfo.label}
                    </strong>
                  </span>
                </div>
                <Button
                  onClick={() => handleWithdraw('amount')}
                  disabled={withdrawBusy != null || !withdrawAmountDraft}
                >
                  {withdrawBusy === 'amount' && <Loader2 className="size-4 animate-spin" />}
                  Withdraw
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleWithdraw('all')}
                  disabled={withdrawBusy != null || !delegation || delegation.balance === 0n}
                >
                  {withdrawBusy === 'all' && <Loader2 className="size-4 animate-spin" />}
                  Withdraw all
                </Button>
              </div>

              {withdrawLastSig && (
                <div className="flex flex-col gap-1.5 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
                  <span className="font-medium text-success">Tx confirmed</span>
                  <a
                    href={transactionExplorerUrl(
                      balance?.network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet',
                      withdrawLastSig,
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-brand hover:underline break-all"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="break-all">{withdrawLastSig}</span>
                  </a>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {localRecord && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-brand" /> Behaviour rules
            </CardTitle>
            <CardDescription>
              The buyer cockpit enforces these rules every time this agent makes an x402 call. Set
              at agent creation and persisted on this device alongside the agent label.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {localRecord.rules === null ? (
              <div className="flex items-center gap-2">
                <Badge variant="outline">limitless</Badge>
                <span className="text-sm text-fg-muted">
                  No budget caps · all hosts allowed · no scheduled triggers.
                </span>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-md border border-border bg-bg-elev/40 p-3">
                  <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                    Daily budget
                  </span>
                  <div className="font-mono text-sm">
                    {localRecord.rules.budget.daily} {localRecord.rules.budget.currency}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-bg-elev/40 p-3">
                  <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                    Per-call cap
                  </span>
                  <div className="font-mono text-sm">
                    {localRecord.rules.budget.perCall} {localRecord.rules.budget.currency}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-bg-elev/40 p-3 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                    Allowed hosts
                  </span>
                  <div className="font-mono text-xs break-all">
                    {localRecord.rules.hosts.allow?.length
                      ? localRecord.rules.hosts.allow.join(', ')
                      : 'any'}
                  </div>
                </div>
                {localRecord.rules.triggers.length > 0 && (
                  <div className="rounded-md border border-border bg-bg-elev/40 p-3 md:col-span-2">
                    <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                      Triggers
                    </span>
                    <JsonViewer data={localRecord.rules.triggers} maxHeight="8rem" />
                  </div>
                )}
              </div>
            )}
            <span className="text-[11px] text-fg-subtle">
              The Privy wallet you used to mint this agent is its <strong>owner</strong>. To make it
              act, register that wallet as an Executive and delegate execution in the{' '}
              <em>Execute (delegation)</em> tab below — see Metaplex&apos;s{' '}
              <a
                href="https://www.metaplex.com/docs/agents/run-an-agent"
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                Run an Agent
              </a>{' '}
              docs.
            </span>
          </CardContent>
        </Card>
      )}

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
              {receiptsPaged.pageItems.map((r) => (
                <ReceiptRow key={r.receipt_hash} receipt={r} />
              ))}
              <Pager
                page={receiptsPaged.page}
                pageCount={receiptsPaged.pageCount}
                onPageChange={receiptsPaged.setPage}
                total={receiptsPaged.total}
                pageSize={receiptsPaged.pageSize}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="identity">
          <Card>
            <CardHeader>
              <CardTitle>Registration document</CardTitle>
              <CardDescription>
                The on-chain <code className="font-mono">AgentIdentity</code> plugin stores a URI
                that points at the agent's metadata. We fetch and display it here. Strict MIP-104 /
                ERC-8004 docs (<code className="font-mono">RegistrationV1</code>) get a "valid"
                badge; the Metaplex Agents API returns a similar-but-non-strict shape and is
                rendered as raw JSON.
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
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-danger">
                    {registration.error}
                    {registration.detail ? `: ${registration.detail}` : ''}
                  </p>
                  <p className="text-[11px] text-fg-subtle">
                    The URI returned a non-2xx response or non-JSON body. Double-check that the URI
                    is publicly fetchable.
                  </p>
                </div>
              ) : registration?.document ? (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {registration.valid ? (
                      <Badge variant="success">RegistrationV1 (MIP-104) valid</Badge>
                    ) : (
                      <Badge variant="warning">non-strict shape</Badge>
                    )}
                    {!registration.valid && registration.schemaError && (
                      <span
                        className="text-[11px] text-fg-subtle truncate max-w-md"
                        title={registration.schemaError}
                      >
                        schema mismatch — showing raw document
                      </span>
                    )}
                  </div>
                  <JsonViewer data={registration.document} maxHeight="32rem" />
                </div>
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
                Per the{' '}
                <a
                  href="https://www.metaplex.com/docs/agents/run-an-agent"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  Metaplex Run-an-Agent guide
                </a>
                , an asset's built-in wallet (Asset Signer PDA) can only act via Core's{' '}
                <code className="font-mono">Execute</code> hook. The asset owner delegates execution
                to a registered <strong>executive</strong>; that executive's wallet then signs{' '}
                <code className="font-mono">Execute</code> instructions on the agent's behalf. Both
                calls below are signed in your browser by your{' '}
                <strong>Privy embedded wallet</strong> — the secret never leaves the device and the
                playground server never holds a key for your account.
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
                <div className="flex flex-col gap-1.5 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
                  <span className="font-medium text-success">Tx confirmed</span>
                  <a
                    href={transactionExplorerUrl(
                      // Map the balance route's `mainnet | devnet` flag back to
                      // an SvmNetwork string. Default to devnet if unknown so
                      // the link still works in local dev.
                      balance?.network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet',
                      execLastSig,
                    )}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 font-mono text-brand hover:underline break-all"
                  >
                    <ExternalLink className="size-3 shrink-0" />
                    <span className="break-all">{execLastSig}</span>
                  </a>
                  <span className="text-[11px] text-fg-subtle">
                    Opens on Solscan ({balance?.network === 'mainnet' ? 'mainnet' : 'devnet'}).
                  </span>
                </div>
              )}
              <p className="text-xs text-fg-subtle leading-relaxed">
                <strong>SDK status</strong> —{' '}
                <code className="font-mono">@leash/registry-utils</code> mirrors the Metaplex
                guide's `registerExecutiveV1`, `delegateExecutionV1`, and{' '}
                <code className="font-mono">verifyDelegation</code> snippets one-for-one. Once
                delegation lands, the executive can sign Core{' '}
                <code className="font-mono">Execute</code> ixs on the agent's behalf. The owner-side{' '}
                <code className="font-mono">mpl-core Execute</code> composition (SPL{' '}
                <code className="font-mono">transferChecked</code> from the treasury) ships in{' '}
                <code className="font-mono">@leash/registry-utils</code> as{' '}
                <code className="font-mono">withdrawTreasury</code> — see the{' '}
                <strong>Withdraw treasury</strong> card above.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * Resolve the "cap" used by the allowance progress bar.
 *
 * Strategy:
 *   1. If we cached the most recent `setSpendDelegation` amount in
 *      localStorage, use it. That's the source of truth for "how much was
 *      originally approved" because SPL `Approve` overwrites the value
 *      and the chain only exposes the current `delegated_amount`.
 *   2. If the on-chain `delegatedAmount` is _bigger_ than the cached cap
 *      (e.g. the user re-approved through another tool), trust the chain
 *      and treat that as the new cap.
 *   3. Otherwise fall back to the on-chain value so the "0% used" state
 *      still renders meaningfully right after a fresh approve.
 */
function computeCap(stored: string | undefined, currentRemaining: bigint): bigint {
  let storedCap = 0n;
  if (stored) {
    try {
      storedCap = BigInt(stored);
    } catch {
      storedCap = 0n;
    }
  }
  if (storedCap === 0n) return currentRemaining;
  if (currentRemaining > storedCap) return currentRemaining;
  return storedCap;
}

/**
 * Stateful "what should I do next?" panel for the spend-allowance card.
 *
 * Picks 1–3 actionable suggestions based on whether the agent has a
 * delegate, treasury balance, and remaining allowance. Each suggestion is
 * a real link (deep-link into /buyer pre-filled with this agent, faucet,
 * etc.) so users aren't left wondering "ok now what".
 */
function NextSteps(props: {
  delegation: SpendDelegationStatus;
  balanceUsdc: number;
  remainingUsdc: number;
  capUsdc: number;
  mint: string;
  usdcLabel: string;
}) {
  const { delegation, balanceUsdc, remainingUsdc, capUsdc, mint, usdcLabel } = props;
  type Step = {
    icon: React.ReactNode;
    title: string;
    body: React.ReactNode;
    tone: 'brand' | 'warning' | 'success';
  };
  const steps: Step[] = [];

  if (!delegation.delegate) {
    steps.push({
      tone: 'brand',
      icon: <KeyRound className="size-4" />,
      title: 'Set an allowance',
      body: (
        <>
          The agent can&apos;t spend until you approve a cap. Use the form below — start with
          something small like <code className="font-mono">5.00 {usdcLabel}</code>.
        </>
      ),
    });
  }

  if (delegation.sourceExists && balanceUsdc <= 0) {
    steps.push({
      tone: 'warning',
      icon: <Wallet className="size-4" />,
      title: 'Fund the treasury',
      body: (
        <>
          Treasury balance is <strong>0 {usdcLabel}</strong>. Send {usdcLabel} to{' '}
          <code className="font-mono break-all">{delegation.sourceTokenAccount}</code>. Devnet?{' '}
          <a
            className="text-brand hover:underline"
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noreferrer"
          >
            Circle faucet ↗
          </a>
        </>
      ),
    });
  }

  if (delegation.delegate && remainingUsdc <= 0) {
    steps.push({
      tone: 'warning',
      icon: <PlusCircle className="size-4" />,
      title: 'Re-approve to top up',
      body: (
        <>
          Cap is exhausted ({capUsdc.toFixed(2)} {usdcLabel} all spent). Re-run{' '}
          <strong>Set allowance</strong> below to extend it.
        </>
      ),
    });
  }

  if (delegation.delegate && remainingUsdc > 0 && balanceUsdc > 0) {
    steps.push({
      tone: 'success',
      icon: <Send className="size-4" />,
      title: 'Try a real x402 call',
      body: (
        <>
          Open the buyer cockpit and fire a request — the agent will sign with the executive and
          settle from the treasury.{' '}
          <Link
            href={`/buyer?agent=${mint}`}
            className="inline-flex items-center gap-1 text-brand hover:underline"
          >
            Go to buyer <ArrowRight className="size-3" />
          </Link>
        </>
      ),
    });
  }

  if (delegation.delegate && remainingUsdc > 0 && capUsdc > 0 && remainingUsdc / capUsdc < 0.2) {
    steps.push({
      tone: 'warning',
      icon: <Sparkles className="size-4" />,
      title: 'Running low',
      body: (
        <>
          Less than 20% of the original cap left ({remainingUsdc.toFixed(4)} {usdcLabel}). Consider
          re-approving before the next big spend.
        </>
      ),
    });
  }

  if (delegation.delegate) {
    steps.push({
      tone: 'brand',
      icon: <ShieldOff className="size-4" />,
      title: 'Lock everything down',
      body: (
        <>
          Use the <strong>Revoke</strong> button to set the cap to 0 and freeze spending.
        </>
      ),
    });
  }

  if (steps.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-bg-elev/40 p-3 flex flex-col gap-2">
      <span className="text-[11px] uppercase tracking-wider text-fg-subtle">What&apos;s next</span>
      <ul className="flex flex-col gap-2">
        {steps.slice(0, 3).map((s, i) => (
          <li
            key={i}
            className={
              'flex items-start gap-2.5 rounded-md border p-2.5 text-xs leading-relaxed ' +
              (s.tone === 'success'
                ? 'border-success/30 bg-success/5 text-fg-default'
                : s.tone === 'warning'
                  ? 'border-warning/30 bg-warning/5 text-fg-default'
                  : 'border-brand/30 bg-brand/5 text-fg-default')
            }
          >
            <span
              className={
                'mt-0.5 ' +
                (s.tone === 'success'
                  ? 'text-success'
                  : s.tone === 'warning'
                    ? 'text-warning'
                    : 'text-brand')
              }
            >
              {s.icon}
            </span>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="font-medium">{s.title}</span>
              <span className="text-fg-muted">{s.body}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
