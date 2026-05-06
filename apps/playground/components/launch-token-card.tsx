/**
 * LaunchTokenCard — Metaplex Genesis "Create an Agent Token" UI.
 *
 * Lives inside the agent profile page (`/agents/[mint]`). Wraps the
 * `launchAgentToken` + `getAgentToken` helpers exported from
 * `@leashmarket/registry-utils` so the playground proves the SDK end-to-end
 * (no UI-only re-implementations of Metaplex flows).
 *
 * UX rules (matching the Metaplex docs):
 *   - `setToken: true` is permanent. We default the toggle to `false`
 *     so a curious user can preview a launch, and bury the "lock in
 *     forever" path behind an explicit confirmation.
 *   - The `image` field must use the gateway host Metaplex validates at
 *     API time — we surface that in the form instead of a hidden 4xx.
 *   - On devnet we suggest `setToken: false` because devnet launches
 *     can't be reused on mainnet anyway.
 *
 * The actual Genesis call happens client-side via the user's Privy
 * embedded wallet (`umi.identity`) — the playground server never
 * forwards a signing key.
 */

'use client';

import * as React from 'react';
import { Coins, ExternalLink, Loader2, ShieldAlert, Sparkles, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import {
  launchAgentToken,
  getAgentToken,
  isGenesisTokenImageUrl,
  type AgentTokenStatus,
  type LaunchAgentTokenResult,
} from '@leashmarket/registry-utils';
import type { Umi } from '@metaplex-foundation/umi';
import { transactionExplorerUrl, addressExplorerUrl } from '@/lib/solscan';

export type LaunchTokenCardProps = {
  /** The agent's MPL Core asset address. */
  agentMint: string;
  /** Privy/Umi instance bound to the connected owner wallet. */
  umi: Umi | null;
  /** Connected wallet (used for the gating message). */
  wallet: { address: string } | null;
  /** Network the agent treasury reports — defaults to devnet for safety. */
  network: 'mainnet' | 'devnet' | undefined;
};

type FormState = {
  name: string;
  symbol: string;
  image: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  setToken: boolean;
  firstBuy: string;
};

const INITIAL_FORM: FormState = {
  name: '',
  symbol: '',
  image: '',
  description: '',
  website: '',
  twitter: '',
  telegram: '',
  setToken: false,
  firstBuy: '',
};

export function LaunchTokenCard(props: LaunchTokenCardProps) {
  const { agentMint, umi, wallet, network } = props;
  const toast = useToast();
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [status, setStatus] = React.useState<AgentTokenStatus | null>(null);
  const [statusError, setStatusError] = React.useState<string | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<LaunchAgentTokenResult | null>(null);

  const svmNetwork: 'solana-mainnet' | 'solana-devnet' =
    network === 'mainnet' ? 'solana-mainnet' : 'solana-devnet';

  const refreshStatus = React.useCallback(async () => {
    if (!umi) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const next = await getAgentToken(umi, agentMint);
      setStatus(next);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatusLoading(false);
    }
  }, [umi, agentMint]);

  React.useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const trimmed = {
    name: form.name.trim(),
    symbol: form.symbol.trim().toUpperCase(),
    image: form.image.trim(),
  };
  const nameValid = trimmed.name.length >= 1 && trimmed.name.length <= 32;
  const symbolValid = trimmed.symbol.length >= 1 && trimmed.symbol.length <= 10;
  const imageValid = trimmed.image.length > 0 && isGenesisTokenImageUrl(trimmed.image);
  const formValid = nameValid && symbolValid && imageValid;
  const firstBuyParsed = form.firstBuy.trim() ? Number(form.firstBuy.trim()) : 0;
  const firstBuyValid =
    form.firstBuy.trim() === '' || (Number.isFinite(firstBuyParsed) && firstBuyParsed >= 0);

  async function handleLaunch() {
    if (!umi || !wallet) {
      toast.error('Connect a wallet', 'Genesis launches require the agent owner wallet.');
      return;
    }
    if (!formValid) {
      toast.error(
        'Check the metadata',
        'Name, symbol, and a valid Genesis gateway image URL are required.',
      );
      return;
    }
    if (!firstBuyValid) {
      toast.error('Invalid first buy', 'First buy must be a non-negative SOL amount.');
      return;
    }
    if (status?.hasToken) {
      toast.info(
        'Token already linked',
        'This agent already has an associated token; new launches will not auto-bind.',
      );
    }

    setBusy(true);
    setResult(null);
    try {
      const launched = await launchAgentToken(umi, {
        agentAsset: agentMint,
        network: svmNetwork,
        setToken: form.setToken,
        token: {
          name: trimmed.name,
          symbol: trimmed.symbol,
          image: trimmed.image,
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          ...(form.website.trim() || form.twitter.trim() || form.telegram.trim()
            ? {
                externalLinks: {
                  ...(form.website.trim() ? { website: form.website.trim() } : {}),
                  ...(form.twitter.trim() ? { twitter: form.twitter.trim() } : {}),
                  ...(form.telegram.trim() ? { telegram: form.telegram.trim() } : {}),
                },
              }
            : {}),
        },
        launch: firstBuyParsed > 0 ? { firstBuyAmount: firstBuyParsed } : {},
      });
      setResult(launched);
      toast.success(
        'Token launched',
        `${trimmed.symbol} live on ${svmNetwork.replace('solana-', '')}.`,
      );
      await refreshStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Launch failed', msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Coins className="size-4 text-brand" /> Launch agent token
        </CardTitle>
        <CardDescription>
          One-shot Metaplex Genesis bonding-curve launch. Creator fees route to this agent&apos;s
          treasury PDA, and the launch transactions are wrapped in{' '}
          <code className="font-mono text-xs">mpl-core::Execute</code> so the agent itself executes
          them on-chain — see the{' '}
          <a
            href="https://www.metaplex.com/docs/agents/create-agent-token"
            target="_blank"
            rel="noreferrer"
            className="text-brand hover:underline"
          >
            Metaplex docs
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!wallet ? (
          <p className="text-sm text-warning">
            Connect a Solana wallet (top-right) to launch a token for this agent.
          </p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2 rounded-md border border-border bg-bg-elev/40 p-3 text-xs">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                  Agent token status
                </span>
                {statusLoading ? (
                  <span className="text-fg-muted">checking…</span>
                ) : statusError ? (
                  <span className="text-danger">{statusError}</span>
                ) : status?.hasToken ? (
                  <div className="flex flex-col gap-1">
                    <Badge variant="success" className="self-start">
                      linked
                    </Badge>
                    <a
                      href={addressExplorerUrl(svmNetwork, status.mint!)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[11px] text-brand hover:underline break-all"
                    >
                      {status.mint}
                    </a>
                  </div>
                ) : (
                  <Badge variant="outline" className="self-start">
                    no token yet
                  </Badge>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 text-[11px] text-fg-subtle">
                <span>identity: {status?.source ?? '—'}</span>
                <span>treasury (PDA receives creator fees):</span>
                <code className="font-mono break-all max-w-[16rem]">{status?.treasury ?? '—'}</code>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-name" className="text-xs">
                  Token name <span className="text-fg-subtle">(1-32 chars)</span>
                </Label>
                <Input
                  id="lt-name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Plexpert Token"
                  maxLength={32}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-symbol" className="text-xs">
                  Symbol <span className="text-fg-subtle">(1-10 chars)</span>
                </Label>
                <Input
                  id="lt-symbol"
                  value={form.symbol}
                  onChange={(e) => set('symbol', e.target.value.toUpperCase())}
                  placeholder="PLX"
                  maxLength={10}
                  className="font-mono"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-image" className="text-xs">
                Image URL <span className="text-fg-subtle">(required)</span>
              </Label>
              <div className="flex flex-col gap-2 rounded-md border border-border bg-bg-elev/40 p-3">
                {imageValid && (
                  <div className="flex items-center gap-3">
                    <img
                      src={form.image.trim()}
                      alt="Token preview"
                      className="size-20 rounded-md border border-border object-cover"
                    />
                    <span className="text-[11px] text-fg-subtle font-mono break-all">
                      {form.image.trim()}
                    </span>
                  </div>
                )}
                <Input
                  id="lt-image"
                  value={form.image}
                  onChange={(e) => set('image', e.target.value)}
                  placeholder="https://… (see Metaplex Genesis token image rules)"
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                {form.image.trim() && !isGenesisTokenImageUrl(form.image) && (
                  <span className="text-warning inline-flex items-start gap-1 text-[11px] leading-relaxed">
                    <TriangleAlert className="size-3 shrink-0 mt-0.5" />
                    <span>
                      This URL does not match the HTTPS image host Metaplex validates for Genesis
                      launches. See{' '}
                      <a
                        href="https://www.metaplex.com/docs/agents/create-agent-token"
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand underline"
                      >
                        Create an Agent Token
                      </a>{' '}
                      for the exact pattern, host your image accordingly, then paste the full URL
                      here.
                    </span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-description" className="text-xs">
                Description <span className="text-fg-subtle">(max 250 chars, optional)</span>
              </Label>
              <Textarea
                id="lt-description"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="The official token of <agent>."
                maxLength={250}
                rows={2}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-website" className="text-xs">
                  Website
                </Label>
                <Input
                  id="lt-website"
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                  placeholder="https://..."
                  className="text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-twitter" className="text-xs">
                  Twitter
                </Label>
                <Input
                  id="lt-twitter"
                  value={form.twitter}
                  onChange={(e) => set('twitter', e.target.value)}
                  placeholder="@handle"
                  className="text-xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-telegram" className="text-xs">
                  Telegram
                </Label>
                <Input
                  id="lt-telegram"
                  value={form.telegram}
                  onChange={(e) => set('telegram', e.target.value)}
                  placeholder="@handle"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-[auto_1fr]">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-firstbuy" className="text-xs">
                  First buy (SOL, fee-free)
                </Label>
                <Input
                  id="lt-firstbuy"
                  value={form.firstBuy}
                  onChange={(e) => set('firstBuy', e.target.value)}
                  placeholder="0.1"
                  inputMode="decimal"
                  className="font-mono"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Permanently bind to this agent</Label>
                <label className="flex items-start gap-2 rounded-md border border-border bg-bg-elev/40 p-3 text-xs leading-relaxed">
                  <input
                    type="checkbox"
                    checked={form.setToken}
                    onChange={(e) => set('setToken', e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>setToken: {form.setToken ? 'true' : 'false'}</strong> — when checked,
                    this launch becomes the agent&apos;s permanent token via{' '}
                    <code className="font-mono">setAgentTokenV1</code>.{' '}
                    <strong>Irreversible.</strong> Leave unchecked to preview on devnet first.
                  </span>
                </label>
                {form.setToken && status?.hasToken && (
                  <span className="text-[11px] text-warning inline-flex items-center gap-1">
                    <ShieldAlert className="size-3" /> Agent already has a token; the on-chain bind
                    will reject this launch.
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-fg-subtle">
                Bonding curve · network: <strong>{svmNetwork}</strong> · creator fees → treasury PDA
              </span>
              <Button onClick={handleLaunch} disabled={busy || !formValid || !firstBuyValid}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                <Sparkles className="size-4" />
                {busy ? 'Launching…' : 'Launch token'}
              </Button>
            </div>

            {result && (
              <div className="flex flex-col gap-2 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="success">launched</Badge>
                  <span className="font-medium text-success">
                    {result.token.id} · {trimmed.symbol}
                  </span>
                </div>
                <div className="grid gap-1 md:grid-cols-2">
                  <div className="flex flex-col">
                    <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                      Mint address
                    </span>
                    <a
                      href={addressExplorerUrl(svmNetwork, result.mintAddress)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[11px] text-brand hover:underline break-all"
                    >
                      {result.mintAddress}
                    </a>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                      Genesis launch page
                    </span>
                    <a
                      href={result.launch.link}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-brand hover:underline break-all inline-flex items-center gap-1"
                    >
                      <ExternalLink className="size-3 shrink-0" />
                      {result.launch.link}
                    </a>
                  </div>
                </div>
                {result.signatures.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                      Tx signatures ({result.signatures.length})
                    </span>
                    {result.signatures.map((sig) => (
                      <a
                        key={sig}
                        href={transactionExplorerUrl(svmNetwork, sig)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[11px] text-brand hover:underline break-all inline-flex items-center gap-1"
                      >
                        <ExternalLink className="size-3 shrink-0" /> {sig}
                      </a>
                    ))}
                  </div>
                )}
                {!result.agentTokenSet && (
                  <span className="text-[11px] text-fg-subtle">
                    The token was created but not bound to this agent (
                    <code className="font-mono">setToken: false</code>). Re-run with the box checked
                    when you&apos;re ready to lock it in.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
