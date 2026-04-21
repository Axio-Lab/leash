'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  CloudUpload,
  ImageIcon,
  Link2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wallet,
  X,
  Info,
} from 'lucide-react';
import { createAgent, setSpendDelegation, type CreateAgentInput } from '@leash/registry-utils';
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

type UriMode = 'pinata' | 'manual';
type ImageMode = 'upload' | 'url';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

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
  uriSource: UriMode;
  /** Whether rules were attached (false = limitless). */
  hasRules: boolean;
  /** Set when an SPL Approve was issued so the executive can spend on the agent's behalf. */
  delegation?: {
    treasury: string;
    sourceTokenAccount: string;
    delegatedAmount: string;
    fundingMint: string;
    fundingMintLabel: string;
    signature: string;
  };
  /** Surfaced when the mint succeeded but the post-mint delegation tx failed (rare). */
  delegationError?: string;
};

const USDC_DEVNET = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const USDC_MAINNET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

/** Pick the USDC mint that matches the agent's chosen network. */
function usdcMintForNetwork(network: Network): { mint: string; label: string } | null {
  if (network === 'solana-devnet') return { mint: USDC_DEVNET, label: 'USDC (devnet)' };
  if (network === 'solana-mainnet') return { mint: USDC_MAINNET, label: 'USDC' };
  return null;
}

function shorten(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export default function NewAgentPage() {
  const toast = useToast();
  const router = useRouter();
  const { umi, wallet, ready } = usePrivyUmi();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [uriMode, setUriMode] = React.useState<UriMode>('pinata');
  const [uri, setUri] = React.useState('');
  const [imageMode, setImageMode] = React.useState<ImageMode>('upload');
  const [imageUrl, setImageUrl] = React.useState('');
  const [imageFile, setImageFile] = React.useState<File | null>(null);
  const [imagePreview, setImagePreview] = React.useState<string | null>(null);
  const [imageError, setImageError] = React.useState<string | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
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

  // ---- Spend allowance (one-time SPL Approve from agent treasury → executive) ----
  // Default $5 covers ~1000 calls @ $0.005 — enough for a real demo without
  // spooking the user. They can revoke / adjust later from /agents/[mint].
  const [spendCapUsdc, setSpendCapUsdc] = React.useState('5.00');
  const usdcInfo = usdcMintForNetwork(network);

  const [busy, setBusy] = React.useState(false);
  const [busyStep, setBusyStep] = React.useState<
    'pinning' | 'minting' | 'persisting' | 'delegating' | null
  >(null);
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
    !busy &&
    umi != null &&
    wallet != null &&
    (uriMode === 'pinata' ? true : uri.trim().length > 0);

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

  React.useEffect(() => {
    if (!imageFile) {
      setImagePreview(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // We deliberately do NOT auto-redirect after a successful mint anymore:
  // the user has to see the operator pubkey (and ideally back it up) on
  // the success card before navigating away. A button on the card opens
  // the explorer in a new tab.

  function handleImageFile(file: File | null) {
    setImageError(null);
    if (!file) {
      setImageFile(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      setImageError(`Only images allowed (got "${file.type || 'unknown'}").`);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(`Max ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setImageFile(file);
  }

  function clearImageFile() {
    setImageFile(null);
    setImageError(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }

  async function pinImageFile(file: File): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/registry/pin-file', { method: 'POST', body: form });
    const json = (await res.json()) as {
      ok?: boolean;
      gatewayUrl?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !json.ok || !json.gatewayUrl) {
      throw new Error(json.detail ?? json.error ?? 'Image upload failed');
    }
    return json.gatewayUrl;
  }

  async function pinMetadata(): Promise<string> {
    setBusyStep('pinning');
    let imageRef: string | undefined;
    if (imageMode === 'upload' && imageFile) {
      imageRef = await pinImageFile(imageFile);
    } else if (imageMode === 'url' && imageUrl.trim()) {
      imageRef = imageUrl.trim();
    }
    const metadata = {
      name: name.trim(),
      description: description.trim(),
      ...(imageRef ? { image: imageRef } : {}),
    };
    const res = await fetch('/api/registry/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: metadata, name: `agent-${name.trim()}` }),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      gatewayUrl?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !json.ok || !json.gatewayUrl) {
      throw new Error(json.detail ?? json.error ?? 'Pinata upload failed');
    }
    return json.gatewayUrl;
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
      // 1. Pin metadata (or use BYO URI).
      const finalUri = uriMode === 'pinata' ? await pinMetadata() : uri.trim();

      // 2. Mint the Core asset + Agent Identity in one tx via the Metaplex
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

      // 4. Spend allowance: ONE-TIME mpl-core::Execute(SPL.Approve) so the
      //    executive (Privy wallet) can move up to `spendCapUsdc` USDC out
      //    of the agent's PDA-owned ATA — this is what makes "client funds
      //    the agent and it goes out to make money" actually work end-to-end.
      //    See packages/registry-utils/src/delegation.ts for the rationale.
      let delegation: CreateOk['delegation'] | undefined;
      let delegationError: string | undefined;
      const capDecimal = Number(spendCapUsdc);
      if (Number.isFinite(capDecimal) && capDecimal > 0 && usdcInfo) {
        try {
          setBusyStep('delegating');
          const atomic = BigInt(Math.round(capDecimal * 1_000_000));
          const approved = await setSpendDelegation(umi, {
            agentAsset: res.assetAddress,
            mint: usdcInfo.mint,
            executive: wallet.address,
            amount: atomic,
          });
          delegation = {
            treasury: approved.treasury,
            sourceTokenAccount: approved.sourceTokenAccount,
            delegatedAmount: spendCapUsdc,
            fundingMint: usdcInfo.mint,
            fundingMintLabel: usdcInfo.label,
            signature: approved.signature,
          };
          saveAgent({
            mint: res.assetAddress,
            label: name.trim(),
            network: res.network,
            owner: wallet.address,
            rules,
            sourceTokenAccount: approved.sourceTokenAccount,
            fundingMint: usdcInfo.mint,
            treasury: approved.treasury,
          });
          toast.success(
            'Spend allowance set',
            `${name.trim()} can now spend up to ${spendCapUsdc} ${usdcInfo.label} from its treasury.`,
          );
        } catch (err) {
          delegationError = err instanceof Error ? err.message : String(err);
          toast.error(
            'Delegation failed',
            'Mint succeeded, but the spend allowance tx failed. You can retry it from the agent page.',
          );
        }
      } else if (!usdcInfo) {
        // The agent was minted on a non-Solana cluster (eclipse, sonic…); skip
        // delegation gracefully. Funding lives outside the playground here.
        delegationError = `Spend allowance is currently only wired for solana-devnet / solana-mainnet (got ${network}).`;
      }

      setResult({
        ok: true,
        ...res,
        owner: wallet.address,
        uri: finalUri,
        uriSource: uriMode,
        hasRules: rules !== null,
        ...(delegation ? { delegation } : {}),
        ...(delegationError ? { delegationError } : {}),
      });
      toast.success(
        'Agent minted',
        `${name.trim()} is now live as ${res.assetAddress.slice(0, 8)}…`,
      );
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

                  {/* Metadata URI: Pinata vs Manual */}
                  <div className="flex flex-col gap-2">
                    <Label>Metadata (on-chain Core asset URI)</Label>
                    <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-bg-elev/40 p-1">
                      <button
                        type="button"
                        onClick={() => setUriMode('pinata')}
                        className={
                          'flex items-center justify-center gap-2 rounded px-3 py-2 text-sm transition ' +
                          (uriMode === 'pinata'
                            ? 'bg-brand text-brand-fg shadow-sm'
                            : 'text-fg-muted hover:text-fg')
                        }
                      >
                        <CloudUpload className="size-4" /> Pin to Pinata for me
                      </button>
                      <button
                        type="button"
                        onClick={() => setUriMode('manual')}
                        className={
                          'flex items-center justify-center gap-2 rounded px-3 py-2 text-sm transition ' +
                          (uriMode === 'manual'
                            ? 'bg-brand text-brand-fg shadow-sm'
                            : 'text-fg-muted hover:text-fg')
                        }
                      >
                        <Link2 className="size-4" /> I have a URI
                      </button>
                    </div>

                    {uriMode === 'pinata' ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-fg-muted font-normal">
                            Image <span className="text-fg-subtle">(optional)</span>
                          </Label>
                          <div className="inline-flex rounded-md border border-border bg-bg-elev/40 p-0.5 text-[11px]">
                            <button
                              type="button"
                              onClick={() => setImageMode('upload')}
                              className={
                                'inline-flex items-center gap-1 rounded px-2 py-1 transition ' +
                                (imageMode === 'upload'
                                  ? 'bg-brand text-brand-fg'
                                  : 'text-fg-muted hover:text-fg')
                              }
                            >
                              <Upload className="size-3" /> Upload
                            </button>
                            <button
                              type="button"
                              onClick={() => setImageMode('url')}
                              className={
                                'inline-flex items-center gap-1 rounded px-2 py-1 transition ' +
                                (imageMode === 'url'
                                  ? 'bg-brand text-brand-fg'
                                  : 'text-fg-muted hover:text-fg')
                              }
                            >
                              <Link2 className="size-3" /> URL
                            </button>
                          </div>
                        </div>

                        {imageMode === 'upload' ? (
                          imageFile ? (
                            <div className="flex items-center gap-3 rounded-md border border-border bg-bg-elev/40 p-2">
                              {imagePreview ? (
                                // Local object-URL preview — next/image isn't worth the
                                // Sharp dependency for a 16-px thumbnail. Plain <img> is fine.
                                <img
                                  src={imagePreview}
                                  alt="Agent preview"
                                  className="size-16 rounded object-cover border border-border"
                                />
                              ) : (
                                <div className="size-16 rounded border border-border grid place-items-center text-fg-subtle">
                                  <ImageIcon className="size-5" />
                                </div>
                              )}
                              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                <span className="truncate text-xs font-medium">
                                  {imageFile.name}
                                </span>
                                <span className="text-[11px] text-fg-subtle">
                                  {(imageFile.size / 1024).toFixed(1)} KB · {imageFile.type}
                                </span>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={clearImageFile}
                                aria-label="Remove image"
                              >
                                <X className="size-4" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => imageInputRef.current?.click()}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                const f = e.dataTransfer.files?.[0];
                                if (f) handleImageFile(f);
                              }}
                              className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-bg-elev/30 px-4 py-6 text-xs text-fg-muted hover:border-brand hover:text-fg transition"
                            >
                              <Upload className="size-5" />
                              <span>
                                <span className="text-fg">Click to upload</span> or drop a PNG / JPG
                                / SVG
                              </span>
                              <span className="text-[11px] text-fg-subtle">
                                Max {MAX_IMAGE_BYTES / 1024 / 1024} MB · pinned to IPFS via Pinata
                              </span>
                            </button>
                          )
                        ) : (
                          <Input
                            id="imageUrl"
                            value={imageUrl}
                            onChange={(e) => setImageUrl(e.target.value)}
                            placeholder="https://example.com/agent.png  ·  ipfs://<cid>"
                            spellCheck={false}
                            className="font-mono text-xs"
                          />
                        )}

                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleImageFile(e.target.files?.[0] ?? null)}
                        />

                        {imageError && (
                          <span className="text-[11px] text-danger">{imageError}</span>
                        )}

                        <span className="text-[11px] text-fg-subtle">
                          We'll build{' '}
                          <code className="font-mono">
                            {'{ name, description'}
                            {(imageMode === 'upload' && imageFile) ||
                            (imageMode === 'url' && imageUrl.trim())
                              ? ', image'
                              : ''}
                            {' }'}
                          </code>
                          , pin it to IPFS via <code className="font-mono">PINATA_JWT</code> on the
                          server, and use the returned gateway URL as the on-chain URI. Requires{' '}
                          <code className="font-mono">PINATA_JWT</code> in{' '}
                          <code className="font-mono">apps/web/.env.local</code>.
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        <Input
                          id="uri"
                          value={uri}
                          onChange={(e) => setUri(e.target.value)}
                          placeholder="https://gateway.pinata.cloud/ipfs/<cid>"
                          required
                          spellCheck={false}
                          className="font-mono text-xs"
                        />
                        <span className="text-[11px] text-fg-subtle">
                          Must be publicly fetchable JSON (Arweave / IPFS / HTTPS) — the standard
                          MPL Core asset metadata pointer.
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      type="button"
                      onClick={() => setFormTab('services')}
                      disabled={!name.trim() || !description.trim()}
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

                  {/* Spend allowance — single SPL Approve from the agent's
                      treasury PDA to the executive (Privy wallet). After this
                      lands, every x402 call debits the AGENT's USDC ATA, not
                      the user's personal balance. The user can revoke or
                      adjust the cap from the agent page later. */}
                  <div className="flex flex-col gap-3 rounded-md border border-border bg-bg-elev/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-col">
                        <Label className="flex items-center gap-2">
                          Spend allowance
                          <span
                            className="inline-flex items-center text-fg-subtle"
                            title="One-time mpl-core::Execute(SPL.Approve) granting your wallet a capped delegation over the agent's USDC ATA. Funds physically live on the agent treasury PDA — your wallet just signs."
                          >
                            <Info className="size-3.5" />
                          </span>
                        </Label>
                        <span className="text-[11px] text-fg-subtle">
                          Cap your wallet can spend on the agent&apos;s behalf. Refill or revoke any
                          time from the agent page.
                        </span>
                      </div>
                      <Badge variant={usdcInfo ? 'brand' : 'outline'} className="self-start">
                        {usdcInfo ? usdcInfo.label : `${network} · skipped`}
                      </Badge>
                    </div>
                    {usdcInfo ? (
                      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="spendCap" className="text-xs">
                            Spend cap ({usdcInfo.label})
                          </Label>
                          <Input
                            id="spendCap"
                            value={spendCapUsdc}
                            onChange={(e) => setSpendCapUsdc(e.target.value)}
                            inputMode="decimal"
                            placeholder="5.00"
                            className="font-mono"
                          />
                          <span className="text-[11px] text-fg-subtle">
                            <code className="font-mono">0</code> skips delegation; you can run it
                            later from <code className="font-mono">/agents/{'{mint}'}</code>.
                          </span>
                        </div>
                        <div className="text-[11px] text-fg-subtle leading-relaxed md:max-w-[14rem]">
                          ≈ {(Number(spendCapUsdc) / 0.005 || 0).toFixed(0)} calls @ $0.005
                          <br />≈ {(Number(spendCapUsdc) / 0.05 || 0).toFixed(0)} calls @ $0.05
                        </div>
                      </div>
                    ) : (
                      <span className="text-[11px] text-warning">
                        Spend allowance only wired for{' '}
                        <code className="font-mono">solana-devnet</code> and{' '}
                        <code className="font-mono">solana-mainnet</code>. You can still mint on{' '}
                        {network} and approve later.
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
                      {busyStep === 'pinning'
                        ? 'Pinning…'
                        : busyStep === 'minting'
                          ? 'Minting…'
                          : busyStep === 'persisting'
                            ? 'Saving…'
                            : busyStep === 'delegating'
                              ? 'Approving spend…'
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
              <CardContent className="flex flex-col gap-3">
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
                    Metadata URI{' '}
                    <Badge variant="outline" className="ml-1">
                      {result.uriSource === 'pinata' ? 'pinned' : 'byo'}
                    </Badge>
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

                {result.delegation && (
                  <div className="flex flex-col gap-1.5 rounded-md border border-brand/30 bg-brand-soft/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                        Spend allowance set
                      </span>
                      <Badge variant="brand">
                        {result.delegation.delegatedAmount} {result.delegation.fundingMintLabel}
                      </Badge>
                    </div>
                    <div className="flex flex-col gap-0.5 text-[11px]">
                      <span className="text-fg-subtle">Treasury (PDA, holds funds)</span>
                      <code className="font-mono break-all">{result.delegation.treasury}</code>
                      <span className="text-fg-subtle mt-1">USDC ATA (debit source)</span>
                      <code className="font-mono break-all">
                        {result.delegation.sourceTokenAccount}
                      </code>
                      <a
                        href={transactionExplorerUrl(result.network, result.delegation.signature)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono break-all text-brand hover:underline mt-1"
                      >
                        Approve tx → {result.delegation.signature.slice(0, 12)}…
                      </a>
                    </div>
                  </div>
                )}
                {result.delegationError && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning leading-relaxed">
                    {result.delegationError}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => router.push(`/agents/${result.assetAddress}`)}>
                    Open profile + manage allowance
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
                <JsonViewer data={result} maxHeight="14rem" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
