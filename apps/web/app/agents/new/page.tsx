'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  ExternalLink,
  Info,
  Plus,
  Sparkles,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  createAgent,
  provisionTreasuryAtas,
  type CreateAgentInput,
  type ProvisionTreasuryAtasResult,
} from '@leash/registry-utils';
import type { RulesV1 } from '@leash/schemas';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/page-header';
import { JsonViewer } from '@/components/json-viewer';
import { useToast } from '@/components/ui/toast';
import { usePrivyUmi } from '@/lib/privy-umi';
import { PRIVY_APP_ID } from '@/lib/env';
import { transactionExplorerUrl } from '@/lib/solscan';
import { saveAgent } from '@/lib/agent-storage';

/** Example MPL Core–style metadata JSON in the Leash repo (for creators to copy / adapt). */
const METADATA_JSON_EXAMPLE_HREF =
  'https://github.com/Axio-Lab/leash/blob/main/apps/web/lib/example.json';

const NETWORKS = [
  'solana-devnet',
  'solana-mainnet',
  'localnet',
  'eclipse-mainnet',
  'sonic-mainnet',
  'sonic-devnet',
  'fogo-mainnet',
  'fogo-testnet',
] as const;

type Network = (typeof NETWORKS)[number];

type Service = { name: string; endpoint: string };

/**
 * Curated trust-model presets per the MIP-104 / ERC-8004 spec. These are
 * the labels an agent uses to declare *how* it backs its claims:
 *   - reputation     → community / on-chain reputation, social proof
 *   - crypto-economic → staking, slashing, bonded operators
 *   - tee            → Trusted Execution Environment attestation
 *   - zk-proof       → zero-knowledge proofs of correct execution
 *
 * The schema (`RegistrationV1.supportedTrust`) is `string[]`, so users can
 * also add custom values (e.g. their own audit framework).
 */
const TRUST_PRESETS: Array<{ value: string; label: string; description: string }> = [
  {
    value: 'reputation',
    label: 'Reputation',
    description: 'Community feedback / on-chain reputation. Trust by track record.',
  },
  {
    value: 'crypto-economic',
    label: 'Crypto-economic',
    description: 'Bonded stake / slashing — misbehaviour costs the operator money.',
  },
  {
    value: 'tee',
    label: 'TEE attestation',
    description: 'Runs inside a Trusted Execution Environment with verifiable attestation.',
  },
  {
    value: 'zk-proof',
    label: 'ZK proof',
    description: 'Publishes zero-knowledge proofs of correct execution.',
  },
];

type CreateOk = {
  ok: true;
  assetAddress: string;
  signature: string;
  network: Network;
  owner: string;
  uri: string;
  /** Whether rules were attached (false = limitless). */
  hasRules: boolean;
  /** Treasury ATAs created (or already-present) for supported stables. */
  treasuryAtas?: ProvisionTreasuryAtasResult['atas'];
  /** Surfaced when ATA provisioning failed (mint still succeeded). */
  provisionError?: string;
};

function shorten(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export default function NewAgentPage() {
  const toast = useToast();
  const router = useRouter();
  const { umi, wallet, ready } = usePrivyUmi();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [uri, setUri] = React.useState('');
  const [network, setNetwork] = React.useState<Network>('solana-devnet');
  const [services, setServices] = React.useState<Service[]>([{ name: 'web', endpoint: '' }]);
  const [trustChecked, setTrustChecked] = React.useState<Record<string, boolean>>({
    reputation: true,
  });
  const [trustCustomDraft, setTrustCustomDraft] = React.useState('');
  const [trustCustom, setTrustCustom] = React.useState<string[]>([]);

  // ---- Behaviour rules (RulesV1). Default = limitless (no policy gate). ----
  const [rulesEnabled, setRulesEnabled] = React.useState(false);
  const [dailyBudget, setDailyBudget] = React.useState('1.00');
  const [perCallCap, setPerCallCap] = React.useState('0.01');
  const [allowedHostsRaw, setAllowedHostsRaw] = React.useState('');
  const [intervalSeconds, setIntervalSeconds] = React.useState(30);

  const [busy, setBusy] = React.useState(false);
  const [busyStep, setBusyStep] = React.useState<'minting' | 'persisting' | 'provisioning' | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreateOk | null>(null);
  const [formTab, setFormTab] = React.useState<'core' | 'services'>('core');

  const supportedTrust = [
    ...TRUST_PRESETS.filter((p) => trustChecked[p.value]).map((p) => p.value),
    ...trustCustom,
  ];

  const canSubmit =
    name.trim() &&
    description.trim() &&
    uri.trim().length > 0 &&
    !busy &&
    umi != null &&
    wallet != null;

  function updateService(idx: number, patch: Partial<Service>) {
    setServices((arr) => arr.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }

  function addCustomTrust() {
    const v = trustCustomDraft.trim().toLowerCase().replace(/\s+/g, '-');
    if (!v) return;
    if (trustCustom.includes(v) || TRUST_PRESETS.some((p) => p.value === v)) {
      setTrustCustomDraft('');
      return;
    }
    setTrustCustom((arr) => [...arr, v]);
    setTrustCustomDraft('');
  }

  // We deliberately do NOT auto-redirect after a successful mint anymore:
  // the user has to see the operator pubkey (and ideally back it up) on
  // the success card before navigating away. A button on the card opens
  // the explorer in a new tab.

  /** Reset inputs after a successful mint so the user can create another agent without stale data. */
  function resetMintForm() {
    setName('');
    setDescription('');
    setUri('');
    setNetwork('solana-devnet');
    setServices([{ name: 'web', endpoint: '' }]);
    setTrustChecked({ reputation: true });
    setTrustCustomDraft('');
    setTrustCustom([]);
    setRulesEnabled(false);
    setDailyBudget('1.00');
    setPerCallCap('0.01');
    setAllowedHostsRaw('');
    setIntervalSeconds(30);
    setFormTab('core');
    setError(null);
  }

  function buildRules(): RulesV1 | null {
    if (!rulesEnabled) return null;
    const hosts = allowedHostsRaw
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter(Boolean);
    return {
      v: '0.1',
      budget: { daily: dailyBudget, perCall: perCallCap, currency: 'USDC' },
      hosts: hosts.length ? { allow: hosts } : {},
      triggers: intervalSeconds > 0 ? [{ type: 'interval', seconds: intervalSeconds }] : [],
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!umi || !wallet) {
      const msg = 'Connect a Solana wallet first.';
      setError(msg);
      toast.error('Wallet required', msg);
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const finalUri = uri.trim();

      // 1. Mint the Core asset + Agent Identity in one tx via the Metaplex
      //    Agent API. The connected Privy wallet becomes the asset owner.
      setBusyStep('minting');
      const filteredServices = services.filter((s) => s.name.trim() && s.endpoint.trim());
      const input: CreateAgentInput = {
        wallet: wallet.address,
        network,
        name: name.trim(),
        description: description.trim(),
        uri: finalUri,
        services: filteredServices,
        supportedTrust,
      };
      const res = await createAgent(umi, input);

      // 3. Persist a local pointer (label + behaviour rules) so the
      //    buyer cockpit can find it. No private keys are stored — every
      //    on-behalf-of-agent action is signed by the connected Privy
      //    wallet acting as the agent's registered Executive (per the
      //    Metaplex "Run an Agent" docs).
      setBusyStep('persisting');
      const rules = buildRules();
      saveAgent({
        mint: res.assetAddress,
        label: name.trim(),
        network: res.network,
        owner: wallet.address,
        rules,
      });

      // 4. Provision the treasury's ATAs for the canonical stables on this
      //    network (USDC on devnet; USDC + USDT on mainnet). One signature,
      //    rent paid once by the connected wallet. After this lands, users
      //    can fund the agent by sending stablecoins to its treasury PDA
      //    and wallets won't refuse to send to "an account with no ATA".
      //    Pre-creating ATAs avoids wallet "no token account" errors when
      //    funding the treasury and simplifies later spend-delegation on the
      //    agent profile (no CreateIdempotent in the Approve tx).
      let treasuryAtas: ProvisionTreasuryAtasResult['atas'] | undefined;
      let provisionError: string | undefined;
      if (network === 'solana-devnet' || network === 'solana-mainnet') {
        try {
          setBusyStep('provisioning');
          const provisioned = await provisionTreasuryAtas(umi, {
            agentAsset: res.assetAddress,
            network,
          });
          treasuryAtas = provisioned.atas;
          const created = provisioned.atas.filter((a) => a.created);
          if (created.length > 0) {
            toast.success(
              'Treasury ATAs provisioned',
              `${created.map((a) => a.symbol ?? a.mint.slice(0, 4)).join(', ')} ready to receive funds.`,
            );
          }
        } catch (err) {
          provisionError = err instanceof Error ? err.message : String(err);
          toast.error(
            'ATA provisioning failed',
            'Mint succeeded, but creating the treasury ATAs failed. You can retry from the agent page.',
          );
        }
      }

      setResult({
        ok: true,
        ...res,
        owner: wallet.address,
        uri: finalUri,
        hasRules: rules !== null,
        ...(treasuryAtas ? { treasuryAtas } : {}),
        ...(provisionError ? { provisionError } : {}),
      });
      const mintedLabel = name.trim();
      toast.success(
        'Agent minted',
        `${mintedLabel} is now live as ${res.assetAddress.slice(0, 8)}…`,
      );
      resetMintForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to create agent', msg);
    } finally {
      setBusy(false);
      setBusyStep(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg w-fit"
      >
        <ArrowLeft className="size-3" /> All agents
      </Link>

      <PageHeader
        eyebrow="@leash/registry-utils · createAgent"
        title="Create an agent"
        description="Mints a fresh MPL Core asset and registers an Agent Identity in a single transaction via Metaplex's Agents API. Your connected Privy wallet pays for and owns the agent."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand" /> Agent details
            </CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">name</code> +{' '}
              <code className="font-mono text-xs">uri</code> become the on-chain Core asset
              metadata. Use tab 2 for service endpoints and trust declarations — they ship in the
              same mint but stay out of your way until you need them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <Tabs value={formTab} onValueChange={(v) => setFormTab(v as 'core' | 'services')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="core">1 · Identity &amp; metadata</TabsTrigger>
                  <TabsTrigger value="services">2 · Services &amp; session</TabsTrigger>
                </TabsList>

                <TabsContent value="core" className="mt-4 flex flex-col gap-5 outline-none">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="name">Name</Label>
                      <Input
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Plexpert"
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="network">Network</Label>
                      <select
                        id="network"
                        value={network}
                        onChange={(e) => setNetwork(e.target.value as Network)}
                        className="h-9 rounded-md border border-border bg-bg-elev px-3 text-sm text-fg"
                      >
                        {NETWORKS.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="description">Description</Label>
                    <Textarea
                      id="description"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="An autonomous agent that does X for Y."
                      rows={3}
                      required
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="uri">Metadata URI (on-chain Core asset)</Label>
                    <Input
                      id="uri"
                      value={uri}
                      onChange={(e) => setUri(e.target.value)}
                      placeholder="https://…/metadata.json"
                      required
                      spellCheck={false}
                      className="font-mono text-xs"
                    />
                    <span className="text-[11px] text-fg-subtle leading-relaxed">
                      Paste a URL to your MPL Core metadata JSON (HTTPS, IPFS gateway, Arweave,
                      etc.). Host the document yourself — include any{' '}
                      <code className="font-mono">image</code> field there if you want artwork on
                      explorers.{' '}
                      <a
                        href={METADATA_JSON_EXAMPLE_HREF}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 font-medium text-brand hover:underline"
                      >
                        Example metadata JSON template
                        <ExternalLink className="size-3 shrink-0" aria-hidden />
                      </a>{' '}
                      (same shape as <code className="font-mono text-[10px]">example.json</code> in
                      the repo).
                    </span>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      onClick={() => setFormTab('services')}
                      disabled={!name.trim() || !description.trim() || !uri.trim()}
                    >
                      Next: services &amp; session <ArrowRight className="size-4" />
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="services" className="mt-4 flex flex-col gap-5 outline-none">
                  <p className="text-[11px] text-fg-subtle leading-relaxed">
                    Service endpoints and trust models are included in the Agent Identity payload
                    Metaplex stores off-chain. Switch back to tab 1 when you&apos;re ready to mint.
                  </p>
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label>Services</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setServices((s) => [...s, { name: '', endpoint: '' }])}
                      >
                        <Plus className="size-3" /> Add
                      </Button>
                    </div>
                    {services.map((s, i) => (
                      <div key={i} className="grid gap-2 md:grid-cols-[10rem_1fr_auto]">
                        <Input
                          value={s.name}
                          onChange={(e) => updateService(i, { name: e.target.value })}
                          placeholder="web · A2A · MCP"
                        />
                        <Input
                          value={s.endpoint}
                          onChange={(e) => updateService(i, { endpoint: e.target.value })}
                          placeholder="https://example.com/agent"
                          className="font-mono text-xs"
                          spellCheck={false}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setServices((arr) => arr.filter((_, j) => j !== i))}
                          disabled={services.length === 1}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Supported trust */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Label>Supported trust models</Label>
                      <span
                        className="inline-flex items-center text-fg-subtle"
                        title="Per the MIP-104 / ERC-8004 spec, agents declare which trust mechanism(s) back their claims. Pick all that apply — buyers and registries can filter by these."
                      >
                        <Info className="size-3.5" />
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      {TRUST_PRESETS.map((p) => {
                        const checked = !!trustChecked[p.value];
                        return (
                          <button
                            key={p.value}
                            type="button"
                            onClick={() =>
                              setTrustChecked((s) => ({ ...s, [p.value]: !s[p.value] }))
                            }
                            className={
                              'flex flex-col items-start gap-1 rounded-md border p-3 text-left transition ' +
                              (checked
                                ? 'border-brand bg-brand-soft/40'
                                : 'border-border bg-bg-elev/40 hover:border-border-strong')
                            }
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="text-sm font-medium">{p.label}</span>
                              <span
                                className={
                                  'grid size-4 place-items-center rounded border ' +
                                  (checked
                                    ? 'border-brand bg-brand text-brand-fg'
                                    : 'border-border')
                                }
                              >
                                {checked && (
                                  <svg viewBox="0 0 16 16" className="size-3" fill="currentColor">
                                    <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                                  </svg>
                                )}
                              </span>
                            </div>
                            <span className="text-[11px] leading-relaxed text-fg-subtle">
                              {p.description}
                            </span>
                            <code className="font-mono text-[10px] text-fg-subtle">{p.value}</code>
                          </button>
                        );
                      })}
                    </div>
                    {trustCustom.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {trustCustom.map((v) => (
                          <Badge
                            key={v}
                            variant="outline"
                            className="font-mono text-[11px] gap-1 pr-1"
                          >
                            {v}
                            <button
                              type="button"
                              onClick={() => setTrustCustom((arr) => arr.filter((x) => x !== v))}
                              className="grid size-4 place-items-center rounded hover:bg-bg-elev-2"
                              aria-label={`Remove ${v}`}
                            >
                              <Trash2 className="size-2.5" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Input
                        value={trustCustomDraft}
                        onChange={(e) => setTrustCustomDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            addCustomTrust();
                          }
                        }}
                        placeholder="add custom (e.g. audit-firm-x)"
                        className="font-mono text-xs"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={addCustomTrust}
                        disabled={!trustCustomDraft.trim()}
                      >
                        <Plus className="size-3" /> Add
                      </Button>
                    </div>
                    {supportedTrust.length === 0 && (
                      <span className="text-[11px] text-warning">
                        No trust models selected — buyers may rank this agent lower.
                      </span>
                    )}
                  </div>

                  {/* Behaviour rules — set ONCE at agent creation. The buyer
                      cockpit reads these directly from agent storage, so the
                      agent is autonomous: no per-call rules form. */}
                  <div className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col">
                        <Label className="flex items-center gap-2">
                          Behaviour rules
                          <span
                            className="inline-flex items-center text-fg-subtle"
                            title="Policy gate evaluated on every x402 call the agent makes. Limitless = no gate (devnet playground default)."
                          >
                            <Info className="size-3.5" />
                          </span>
                        </Label>
                        <span className="text-[11px] text-fg-subtle">
                          Saved with this device&apos;s agent record. The buyer cockpit enforces
                          them on every call the agent makes.
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setRulesEnabled((v) => !v)}
                        className={
                          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ' +
                          (rulesEnabled ? 'bg-brand' : 'bg-bg-elev-2')
                        }
                        aria-pressed={rulesEnabled}
                        aria-label="Toggle behaviour rules"
                      >
                        <span
                          className={
                            'inline-block size-4 rounded-full bg-white transition ' +
                            (rulesEnabled ? 'translate-x-6' : 'translate-x-1')
                          }
                        />
                      </button>
                    </div>
                    {!rulesEnabled ? (
                      <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                        <Badge variant="outline">limitless</Badge>
                        No budget caps · all hosts allowed · no scheduled triggers.
                      </div>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="dailyBudget" className="text-xs">
                            Daily budget (USDC)
                          </Label>
                          <Input
                            id="dailyBudget"
                            value={dailyBudget}
                            onChange={(e) => setDailyBudget(e.target.value)}
                            inputMode="decimal"
                            className="font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="perCallCap" className="text-xs">
                            Per-call cap (USDC)
                          </Label>
                          <Input
                            id="perCallCap"
                            value={perCallCap}
                            onChange={(e) => setPerCallCap(e.target.value)}
                            inputMode="decimal"
                            className="font-mono"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5 md:col-span-2">
                          <Label htmlFor="allowedHosts" className="text-xs">
                            Allowed hosts <span className="text-fg-subtle">(blank = any)</span>
                          </Label>
                          <Input
                            id="allowedHosts"
                            value={allowedHostsRaw}
                            onChange={(e) => setAllowedHostsRaw(e.target.value)}
                            placeholder="api.example.com, weather.io"
                            className="font-mono text-xs"
                            spellCheck={false}
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="intervalSeconds" className="text-xs">
                            Trigger interval (seconds, 0 = none)
                          </Label>
                          <Input
                            id="intervalSeconds"
                            type="number"
                            min={0}
                            value={intervalSeconds}
                            onChange={(e) => setIntervalSeconds(Number(e.target.value) || 0)}
                            className="font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <Button type="button" variant="ghost" onClick={() => setFormTab('core')}>
                      <ArrowLeft className="size-4" /> Back
                    </Button>
                    <Button type="submit" disabled={!canSubmit}>
                      <Sparkles className="size-4" />{' '}
                      {busyStep === 'minting'
                        ? 'Minting…'
                        : busyStep === 'persisting'
                          ? 'Saving…'
                          : busyStep === 'provisioning'
                            ? 'Provisioning ATAs…'
                            : 'Create agent'}
                    </Button>
                    {!ready && <span className="text-sm text-fg-muted">Loading wallet…</span>}
                    {ready && !wallet && (
                      <span className="text-sm text-warning">
                        Connect a Solana wallet (top-right) to sign.
                      </span>
                    )}
                    {error && <span className="text-sm text-danger">{error}</span>}
                  </div>
                </TabsContent>
              </Tabs>
            </form>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wallet className="size-4 text-brand" /> Signer
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-fg-muted leading-relaxed flex flex-col gap-2">
              {!PRIVY_APP_ID ? (
                <span>
                  <code className="font-mono">NEXT_PUBLIC_PRIVY_APP_ID</code> is not set, so the
                  Privy wallet is disabled. Add it to{' '}
                  <code className="font-mono">apps/web/.env.local</code> and restart{' '}
                  <code className="font-mono">pnpm dev</code>.
                </span>
              ) : ready && wallet ? (
                <>
                  <span>
                    Privy signs the <strong>mint transaction</strong> and becomes the agent
                    <strong> owner</strong>. After mint, you&apos;ll register this same wallet as
                    the agent&apos;s <strong>Executive</strong> (per Metaplex&apos;s{' '}
                    <a
                      href="https://www.metaplex.com/docs/agents/run-an-agent"
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand hover:underline"
                    >
                      Run an Agent
                    </a>{' '}
                    docs) so it can sign Core <code className="font-mono">Execute</code>{' '}
                    instructions on the agent&apos;s behalf — no separate operator keypair is stored
                    anywhere.
                  </span>
                  <code className="font-mono text-[11px] break-all text-fg">{wallet.address}</code>
                  <Badge variant="brand" className="self-start">
                    owner · {shorten(wallet.address)}
                  </Badge>
                </>
              ) : (
                <span>
                  Open the wallet menu in the top-right to log in. Privy will create or connect a
                  Solana wallet for you.
                </span>
              )}
              <span className="text-[11px] text-fg-subtle">
                Make sure the wallet is funded on the chosen network — devnet faucet:{' '}
                <code className="font-mono">solana airdrop 1 &lt;pubkey&gt; --url devnet</code>.
              </span>
            </CardContent>
          </Card>

          {result && (
            <Card className="border-brand/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Bot className="size-4 text-brand" /> Agent minted
                </CardTitle>
                <CardDescription>
                  Next: open the agent profile, register your wallet as an{' '}
                  <strong>Executive</strong>, and delegate execution. After that the agent can pay
                  and earn over x402 with your wallet signing on its behalf.
                </CardDescription>
              </CardHeader>
              <CardContent className="min-w-0 overflow-hidden flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                    Asset address (agent identity)
                  </span>
                  <code className="font-mono text-[11px] break-all">{result.assetAddress}</code>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                    Behaviour rules
                  </span>
                  <Badge variant={result.hasRules ? 'brand' : 'outline'} className="self-start">
                    {result.hasRules ? 'custom rules attached' : 'limitless'}
                  </Badge>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                    Metadata URI
                  </span>
                  <a
                    href={result.uri}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] break-all text-brand hover:underline"
                  >
                    {result.uri}
                  </a>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                    Tx signature
                  </span>
                  <a
                    href={transactionExplorerUrl(result.network, result.signature)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11px] break-all text-brand hover:underline"
                  >
                    {result.signature}
                  </a>
                </div>
                <Badge variant="brand">{result.network}</Badge>

                {result.treasuryAtas && result.treasuryAtas.length > 0 && (
                  <div className="flex flex-col gap-1.5 rounded-md border border-border bg-bg-elev/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                        Treasury ATAs
                      </span>
                      <Badge variant="outline">
                        {result.treasuryAtas.filter((a) => a.created).length} created ·{' '}
                        {result.treasuryAtas.filter((a) => !a.created).length} existed
                      </Badge>
                    </div>
                    <span className="text-[11px] text-fg-subtle">
                      Send these mints to the treasury and the agent can spend them. One-time rent
                      paid by your wallet.
                    </span>
                    <div className="flex flex-col gap-1">
                      {result.treasuryAtas.map((a) => (
                        <div key={a.address} className="grid gap-1 text-[11px] min-w-0">
                          <Badge variant={a.created ? 'brand' : 'outline'} className="w-fit">
                            {a.symbol ?? a.mint.slice(0, 4)}
                          </Badge>
                          <code className="font-mono break-all text-fg-muted min-w-0">
                            {a.address}
                          </code>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {result.provisionError && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning leading-relaxed break-all overflow-hidden">
                    {result.provisionError}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => router.push(`/agents/${result.assetAddress}`)}>
                    Open profile
                  </Button>
                  <Button variant="ghost" asChild>
                    <a
                      href={transactionExplorerUrl(result.network, result.signature)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Inspect tx on explorer
                    </a>
                  </Button>
                </div>
                <JsonViewer data={result} maxHeight="14rem" className="min-w-0 max-w-full" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
