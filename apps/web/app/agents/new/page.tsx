'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
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
import { createAgent, type CreateAgentInput } from '@leash/registry-utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/page-header';
import { JsonViewer } from '@/components/json-viewer';
import { usePrivyUmi } from '@/lib/privy-umi';
import { PRIVY_APP_ID } from '@/lib/env';
import { transactionExplorerUrl } from '@/lib/solscan';

type SavedAgent = {
  mint: string;
  label?: string;
  capability?: 'buyer' | 'seller' | 'both';
  createdAt: string;
};

const STORAGE_KEY = 'leash:web:agents';
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
};

function persistAgent(saved: SavedAgent) {
  if (typeof window === 'undefined') return;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const list: SavedAgent[] = raw ? (JSON.parse(raw) as SavedAgent[]) : [];
  const next = [saved, ...list.filter((a) => a.mint !== saved.mint)];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function shorten(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

export default function NewAgentPage() {
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
  const [busy, setBusy] = React.useState(false);
  const [busyStep, setBusyStep] = React.useState<'pinning' | 'minting' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CreateOk | null>(null);

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

  /** After mint, redirect to Solscan (or Explorer fallback) to inspect the tx. */
  const explorerRedirected = React.useRef(false);
  React.useEffect(() => {
    if (!result?.signature || explorerRedirected.current) return;
    explorerRedirected.current = true;
    const href = transactionExplorerUrl(result.network, result.signature);
    const t = window.setTimeout(() => {
      window.location.assign(href);
    }, 400);
    return () => window.clearTimeout(t);
  }, [result]);

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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!umi || !wallet) {
      setError('Connect a Solana wallet first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const finalUri = uriMode === 'pinata' ? await pinMetadata() : uri.trim();
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
      const ok: CreateOk = {
        ok: true,
        ...res,
        owner: wallet.address,
        uri: finalUri,
        uriSource: uriMode,
      };
      setResult(ok);
      persistAgent({
        mint: res.assetAddress,
        label: name.trim(),
        capability: 'both',
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
              metadata. Everything else is stored off-chain by the Metaplex API.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
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
                            <span className="truncate text-xs font-medium">{imageFile.name}</span>
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
                            <span className="text-fg">Click to upload</span> or drop a PNG / JPG /
                            SVG
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

                    {imageError && <span className="text-[11px] text-danger">{imageError}</span>}

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
                      Must be publicly fetchable JSON (Arweave / IPFS / HTTPS) — the standard MPL
                      Core asset metadata pointer.
                    </span>
                  </div>
                )}
              </div>

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
                        onClick={() => setTrustChecked((s) => ({ ...s, [p.value]: !s[p.value] }))}
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
                              (checked ? 'border-brand bg-brand text-brand-fg' : 'border-border')
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
                      <Badge key={v} variant="outline" className="font-mono text-[11px] gap-1 pr-1">
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

              <div className="flex items-center gap-3">
                <Button type="submit" disabled={!canSubmit}>
                  <Sparkles className="size-4" />{' '}
                  {busyStep === 'pinning'
                    ? 'Pinning…'
                    : busyStep === 'minting'
                      ? 'Minting…'
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
                    Signing with the connected Privy wallet. This wallet pays for the transaction
                    and <strong>becomes the agent owner</strong>.
                  </span>
                  <code className="font-mono text-[11px] break-all text-fg">{wallet.address}</code>
                  <Badge variant="brand" className="self-start">
                    {shorten(wallet.address)}
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
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Bot className="size-4 text-brand" /> Mint succeeded
                </CardTitle>
                <CardDescription>
                  Opening Solscan (or Solana Explorer for unsupported clusters) to inspect this
                  transaction…
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-wider text-fg-subtle">
                    Asset address
                  </span>
                  <code className="font-mono text-[11px] break-all">{result.assetAddress}</code>
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
                  <code className="font-mono text-[11px] break-all">{result.signature}</code>
                </div>
                <Badge variant="brand">{result.network}</Badge>
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/agents/${result.assetAddress}`)}
                >
                  Open agent profile
                </Button>
                <JsonViewer data={result} maxHeight="14rem" />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
