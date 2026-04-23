'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import {
  ArrowDownToLine,
  ArrowLeft,
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
  TriangleAlert,
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
  withdrawTreasurySol,
  withdrawTreasurySolAll,
  TOKEN_2022_PROGRAM_ID,
  type ProvisionTreasuryAtasResult,
  type SpendDelegationStatus,
} from '@leash/registry-utils';
import { publicKey as toPubkey } from '@metaplex-foundation/umi';
import { KNOWN_TOKENS, KNOWN_STABLE_SYMBOLS, type KnownStableSymbol } from '@leash/core';
import { transactionExplorerUrl } from '@/lib/solscan';
import { LaunchTokenCard } from '@/components/launch-token-card';
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
  // `'SOL'` is a synthetic entry — it's not in `KNOWN_STABLE_SYMBOLS`
  // because the registry tracks SPL mints, not native lamports. We
  // special-case it through every consumer below so the withdraw card
  // can drain Genesis creator fees (which accrue as raw SOL on the
  // treasury PDA) without spinning up a parallel UI.
  type WithdrawSymbol = KnownStableSymbol | 'SOL';
  const [withdrawCurrency, setWithdrawCurrency] = React.useState<WithdrawSymbol>('USDC');
  const isSolWithdraw = withdrawCurrency === 'SOL';

  // Resolve the active withdraw token from the (network-aware) registry.
  // Defaults to the network's USDC entry if the user picked a symbol not
  // catalogued on the current cluster (rare, but possible if devnet
  // entries diverge from mainnet). When the user picks SOL we synthesize
  // a token-shaped object so the rest of the form (amount input,
  // balance pill, etc.) stays uniform.
  const withdrawToken = React.useMemo(() => {
    const network = balance?.network ?? 'devnet';
    if (withdrawCurrency === 'SOL') {
      return {
        symbol: 'SOL' as const,
        // No SPL mint for native SOL; consumers must check `isSolWithdraw`
        // before reading `mint`.
        mint: '',
        decimals: 9,
        program: 'native' as const,
      };
    }
    const entry =
      KNOWN_TOKENS[network].find((t) => t.symbol.toUpperCase() === withdrawCurrency) ??
      KNOWN_TOKENS[network].find((t) => t.symbol === 'USDC')!;
    return {
      symbol: entry.symbol,
      mint: entry.mint,
      decimals: entry.decimals,
      program: entry.program,
    };
  }, [balance?.network, withdrawCurrency]);

  // Read the agent's balance for the chosen withdraw token from the
  // /api/agents/balance feed (which lists every SPL stable held by the
  // treasury PDA, plus the SOL lamport count). Falls back to
  // `delegation.balance` for USDC because that's the legacy code path
  // and is more responsive after a fresh approve/withdraw cycle.
  const withdrawBalanceUi = React.useMemo(() => {
    if (isSolWithdraw) return balance?.sol ?? 0;
    if (withdrawToken.symbol === 'USDC' && delegation) {
      return Number(delegation.balance) / 10 ** withdrawToken.decimals;
    }
    const tok = balance?.tokens.find((t) => t.mint === withdrawToken.mint);
    return tok?.ui ?? 0;
  }, [isSolWithdraw, balance?.sol, withdrawToken, delegation, balance?.tokens]);
  const withdrawBalanceAtomic = React.useMemo(() => {
    if (isSolWithdraw) {
      // `/api/agents/balance` returns lamports as a string for lossless
      // round-trip — parse to bigint here to keep the "withdraw all"
      // gate accurate even at large balances.
      try {
        return BigInt(balance?.lamports ?? '0');
      } catch {
        return 0n;
      }
    }
    if (withdrawToken.symbol === 'USDC' && delegation) return delegation.balance;
    const tok = balance?.tokens.find((t) => t.mint === withdrawToken.mint);
    if (!tok) return 0n;
    try {
      return BigInt(tok.amount);
    } catch {
      return 0n;
    }
  }, [isSolWithdraw, balance?.lamports, withdrawToken, delegation, balance?.tokens]);

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
      // Dispatch on currency: SOL routes through `withdrawTreasurySol*`
      // (mpl-core::Execute wrapping a raw System.Transfer); SPL stables
      // continue to use the TransferChecked path.
      let signature: string;
      let sentDecimal: number;
      if (isSolWithdraw) {
        if (mode === 'all') {
          const r = await withdrawTreasurySolAll(privyUmi, {
            agentAsset: mint,
            destination,
          });
          if (!r) {
            toast.info(
              'Nothing to withdraw',
              'Treasury SOL balance is below the rent-exempt safety reserve.',
            );
            return;
          }
          signature = r.signature;
          sentDecimal = Number(r.lamports) / 1_000_000_000;
        } else {
          const decimal = Number(withdrawAmountDraft);
          if (!Number.isFinite(decimal) || decimal <= 0) {
            toast.error('Invalid amount', 'Enter a positive SOL amount.');
            return;
          }
          const lamports = BigInt(Math.round(decimal * 1_000_000_000));
          const r = await withdrawTreasurySol(privyUmi, {
            agentAsset: mint,
            destination,
            lamports,
          });
          signature = r.signature;
          sentDecimal = decimal;
        }
      } else {
        const tokenProgram =
          withdrawToken.program === 'spl-token-2022' ? TOKEN_2022_PROGRAM_ID : undefined;
        let res;
        if (mode === 'all') {
          res = await withdrawTreasuryAll(privyUmi, {
            agentAsset: mint,
            mint: toPubkey(withdrawToken.mint),
            destination,
            ...(tokenProgram ? { tokenProgram, decimals: withdrawToken.decimals } : {}),
          });
          if (!res) {
            toast.info('Nothing to withdraw', `Treasury ${withdrawToken.symbol} balance is 0.`);
            return;
          }
        } else {
          const decimal = Number(withdrawAmountDraft);
          if (!Number.isFinite(decimal) || decimal <= 0) {
            toast.error('Invalid amount', `Enter a positive ${withdrawToken.symbol} amount.`);
            return;
          }
          const factor = 10 ** withdrawToken.decimals;
          const atomic = BigInt(Math.round(decimal * factor));
          res = await withdrawTreasury(privyUmi, {
            agentAsset: mint,
            mint: toPubkey(withdrawToken.mint),
            destination,
            amount: atomic,
            ...(tokenProgram ? { tokenProgram, decimals: withdrawToken.decimals } : {}),
          });
        }
        signature = res.signature;
        sentDecimal = Number(res.amount) / 10 ** withdrawToken.decimals;
      }
      setWithdrawLastSig(signature);
      toast.success(
        'Withdrawal confirmed',
        `${sentDecimal.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 9,
        })} ${withdrawToken.symbol} sent to ${destination.slice(0, 8)}\u2026${destination.slice(-4)}.`,
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
              title={
                'Pre-creates the agent treasury\u2019s SPL token accounts (ATAs) for ' +
                'USDC, USDT, and USDG. One signed transaction; idempotent. Re-run if a ' +
                'wallet says \u201CRecipient has no token account\u201D when sending stables.'
              }
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
                          {t.program === 'spl-token-2022' && !t.known && (
                            // Only surface the Token-2022 chip for unknown
                            // mints where it acts as a diagnostic. For
                            // known stables (USDG etc.) the program is
                            // implicit in the registry and the badge is
                            // visual noise.
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
              call. Re-approve to top up; revoke to lock everything down.
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

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="allowance" className="text-xs">
                      New allowance ({usdcInfo.label})
                    </Label>
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                      <Input
                        id="allowance"
                        value={allowanceDraft}
                        onChange={(e) => setAllowanceDraft(e.target.value)}
                        inputMode="decimal"
                        placeholder="5.00"
                        className="font-mono h-9 w-full md:min-w-0 md:flex-1"
                      />
                      <div className="flex shrink-0 flex-row flex-wrap gap-2 md:justify-end">
                        <Button
                          className="h-9 shrink-0"
                          onClick={handleSetAllowance}
                          disabled={allowanceBusy != null}
                        >
                          {allowanceBusy === 'set' && <Loader2 className="size-4 animate-spin" />}
                          Set allowance
                        </Button>
                        <Button
                          variant="secondary"
                          className="h-9 shrink-0"
                          onClick={handleRevokeAllowance}
                          disabled={allowanceBusy != null || !delegation.delegate}
                        >
                          {allowanceBusy === 'revoke' && (
                            <Loader2 className="size-4 animate-spin" />
                          )}
                          Revoke
                        </Button>
                      </div>
                    </div>
                    <span className="text-[11px] text-fg-subtle">
                      Sets the cap (overwrites any existing one). Top up by re-approving. Use the
                      Revoke button to set the cap to 0 (freeze spending).
                    </span>
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
            <ArrowDownToLine className="size-4 text-brand" /> Withdraw treasury (
            {withdrawToken.symbol})
          </CardTitle>
          <CardDescription>
            Withdraw any of the agent&apos;s SPL stables or native SOL (creator fees from a Genesis
            token launch route here) out of its treasury.
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
                    Defaults to your owner wallet.{' '}
                    {isSolWithdraw ? (
                      <>
                        Native SOL is sent directly via{' '}
                        <code className="font-mono">SystemProgram.Transfer</code> — no ATA needed.
                      </>
                    ) : (
                      <>
                        We send to this address&apos;s{' '}
                        <code className="font-mono">{withdrawToken.symbol}</code> ATA — created on
                        the fly if missing.
                      </>
                    )}
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

              <div className="flex flex-col gap-3 md:flex-row md:items-start md:gap-4">
                <div className="flex w-full flex-col gap-1.5 md:w-46 md:shrink-0">
                  <Label htmlFor="withdraw-currency" className="text-xs">
                    Token
                  </Label>
                  <select
                    id="withdraw-currency"
                    value={withdrawCurrency}
                    onChange={(e) => {
                      setWithdrawCurrency(e.target.value as WithdrawSymbol);
                      setWithdrawAmountDraft('');
                    }}
                    className="h-9 w-full rounded-md border border-border bg-bg-elev px-3 text-sm"
                    disabled={withdrawBusy != null}
                  >
                    {KNOWN_STABLE_SYMBOLS.map((sym) => (
                      <option key={sym} value={sym}>
                        {sym}
                      </option>
                    ))}
                    {/* Native SOL is appended last so the SPL stables
                        keep their familiar ordering at the top of the
                        list. */}
                    <option value="SOL">SOL (native)</option>
                  </select>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor="withdraw-amount" className="text-xs">
                    Amount ({withdrawToken.symbol})
                  </Label>
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                    <Input
                      id="withdraw-amount"
                      value={withdrawAmountDraft}
                      onChange={(e) => setWithdrawAmountDraft(e.target.value)}
                      inputMode="decimal"
                      placeholder="1.00"
                      className="font-mono h-9 w-full md:min-w-0 md:flex-1"
                    />
                    <div className="flex shrink-0 flex-row flex-wrap gap-2 md:justify-end">
                      <Button
                        className="h-9 shrink-0"
                        onClick={() => handleWithdraw('amount')}
                        disabled={withdrawBusy != null || !withdrawAmountDraft}
                      >
                        {withdrawBusy === 'amount' && <Loader2 className="size-4 animate-spin" />}
                        Withdraw
                      </Button>
                      <Button
                        variant="secondary"
                        className="h-9 shrink-0"
                        onClick={() => handleWithdraw('all')}
                        disabled={withdrawBusy != null || withdrawBalanceAtomic === 0n}
                      >
                        {withdrawBusy === 'all' && <Loader2 className="size-4 animate-spin" />}
                        Withdraw all
                      </Button>
                    </div>
                  </div>
                  <span className="text-[11px] text-fg-subtle">
                    Treasury balance:{' '}
                    <strong className="text-fg-muted">
                      {withdrawBalanceUi.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      })}{' '}
                      {withdrawToken.symbol}
                    </strong>
                  </span>
                </div>
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
          <TabsTrigger value="token">Token (Genesis)</TabsTrigger>
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

        <TabsContent value="token">
          <LaunchTokenCard
            agentMint={mint}
            umi={privyUmi ?? null}
            wallet={privyWallet}
            network={balance?.network}
          />
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
