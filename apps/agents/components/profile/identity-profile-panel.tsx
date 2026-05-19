'use client';

import * as React from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  BadgeCheckIcon,
  GlobeIcon,
  IdCardIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type CapabilityCard = {
  id: string;
  kind:
    | 'seller_api'
    | 'buyer_tool'
    | 'data_source'
    | 'control_channel'
    | 'automation'
    | 'marketplace'
    | 'pay_skills'
    | 'custom';
  title: string;
  description?: string;
  source?: 'leash' | 'pay-skills' | 'manual' | 'connection' | 'automation';
  slug?: string;
  endpoint?: string;
  tags: string[];
  protocols: Array<'x402' | 'mpp'>;
  visibility: 'public' | 'private';
};

type IdentityClaim = {
  id: string;
  issuer: string;
  type: string;
  value: string;
  visibility: 'public' | 'private';
  signature: string;
  created_at: string;
};

type IdentityProfile = {
  mint: string;
  handle: string | null;
  verified_domains: string[];
  capability_cards: CapabilityCard[];
  claims: IdentityClaim[];
  operator_history: unknown[];
  reputation: { settled_calls: number; denied_calls: number; rating: number };
};

const fetcher = async (url: string): Promise<IdentityProfile> => {
  const res = await fetch(url, { credentials: 'include' });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'message' in json
        ? String(json.message)
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return json as IdentityProfile;
};

export function IdentityProfilePanel({ agentMint }: { agentMint: string }) {
  const { data, error, isLoading, mutate } = useSWR<IdentityProfile>(
    `/api/agents/${agentMint}/identity`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const [handle, setHandle] = React.useState('');
  const [domain, setDomain] = React.useState('');
  const [cardTitle, setCardTitle] = React.useState('');
  const [cardEndpoint, setCardEndpoint] = React.useState('');
  const [cardKind, setCardKind] = React.useState<CapabilityCard['kind']>('custom');
  const [cardVisibility, setCardVisibility] = React.useState<'public' | 'private'>('public');
  const [claimType, setClaimType] = React.useState('');
  const [claimValue, setClaimValue] = React.useState('');
  const [claimSignature, setClaimSignature] = React.useState('');
  const [claimVisibility, setClaimVisibility] = React.useState<'public' | 'private'>('public');
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (data?.handle) setHandle(data.handle);
  }, [data?.handle]);

  async function saveIdentity(next: {
    handle?: string | null;
    capability_cards?: Omit<CapabilityCard, 'id'>[] | CapabilityCard[];
  }) {
    setBusy('identity');
    try {
      const res = await fetch(`/api/agents/${agentMint}/identity`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? json?.detail ?? `HTTP ${res.status}`);
      toast.success('Identity updated');
      await mutate(json as IdentityProfile, { revalidate: false });
    } catch (err) {
      toast.error('Identity update failed', { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function verifyDomain() {
    if (!domain.trim()) return;
    setBusy('domain');
    try {
      const res = await fetch(`/api/agents/${agentMint}/identity/domains/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? json?.detail ?? `HTTP ${res.status}`);
      toast.success('Domain verified');
      setDomain('');
      await mutate();
    } catch (err) {
      toast.error('Domain verification failed', { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function addCapabilityCard() {
    if (!cardTitle.trim()) return;
    const current = data?.capability_cards ?? [];
    const next = [
      ...current,
      {
        kind: cardKind,
        title: cardTitle.trim(),
        ...(cardEndpoint.trim() ? { endpoint: cardEndpoint.trim() } : {}),
        source: 'manual' as const,
        tags: [],
        protocols: [],
        visibility: cardVisibility,
      },
    ];
    await saveIdentity({ capability_cards: next });
    setCardTitle('');
    setCardEndpoint('');
    setCardKind('custom');
    setCardVisibility('public');
  }

  async function addClaim() {
    if (!claimType.trim() || !claimValue.trim() || !claimSignature.trim()) return;
    setBusy('claim');
    try {
      const res = await fetch(`/api/agents/${agentMint}/identity/claims`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          issuer: 'owner',
          type: claimType.trim(),
          value: claimValue.trim(),
          signature: claimSignature.trim(),
          visibility: claimVisibility,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message ?? json?.detail ?? `HTTP ${res.status}`);
      toast.success('Claim saved');
      setClaimType('');
      setClaimValue('');
      setClaimSignature('');
      setClaimVisibility('public');
      await mutate();
    } catch (err) {
      toast.error('Claim save failed', { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function revokeClaim(id: string) {
    setBusy(`claim:${id}`);
    try {
      const res = await fetch(`/api/agents/${agentMint}/identity/claims/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.message ?? json?.detail ?? `HTTP ${res.status}`);
      }
      toast.success('Claim revoked');
      await mutate();
    } catch (err) {
      toast.error('Claim revoke failed', { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold tracking-tight flex items-center gap-2">
            <IdCardIcon className="size-3.5 text-brand-strong" />
            Agent identity profile
          </h3>
          <p className="text-xs text-fg-muted mt-0.5">
            Handles, verified domains, claims, and capability cards attached to this agent mint.
          </p>
        </div>
        {isLoading ? (
          <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
            <Spinner size="sm" /> Loading
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {(error as Error).message}
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-border/60 bg-bg/40 p-3 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
            <BadgeCheckIcon className="size-3.5" />
            Handle
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              placeholder="agent-handle"
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy === 'identity'}
              onClick={() => saveIdentity({ handle: handle.trim() || null })}
            >
              Save
            </Button>
          </div>
          <div className="text-xs text-fg-muted">
            Current:{' '}
            <span className="font-mono text-fg">{data?.handle ? `@${data.handle}` : 'none'}</span>
          </div>
        </div>

        <div className="rounded-lg border border-border/60 bg-bg/40 p-3 space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
            <GlobeIcon className="size-3.5" />
            Verified domains
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="example.com"
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy === 'domain'}
              onClick={verifyDomain}
            >
              Verify
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(data?.verified_domains ?? []).length === 0 ? (
              <span className="text-xs text-fg-muted">No verified domains</span>
            ) : (
              data!.verified_domains.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success"
                >
                  {item}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-border/60 bg-bg/40 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
              Capability cards
            </div>
            <span className="text-xs text-fg-muted">{data?.capability_cards.length ?? 0}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-[1fr_0.8fr_0.7fr]">
            <input
              value={cardTitle}
              onChange={(event) => setCardTitle(event.target.value)}
              placeholder="Capability name"
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
            />
            <select
              value={cardKind}
              onChange={(event) => setCardKind(event.target.value as CapabilityCard['kind'])}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand/40"
            >
              <option value="custom">Custom</option>
              <option value="pay_skills">pay.sh</option>
              <option value="marketplace">Marketplace</option>
              <option value="data_source">Data source</option>
              <option value="control_channel">Control channel</option>
              <option value="automation">Automation</option>
            </select>
            <select
              value={cardVisibility}
              onChange={(event) => setCardVisibility(event.target.value as 'public' | 'private')}
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand/40"
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={cardEndpoint}
              onChange={(event) => setCardEndpoint(event.target.value)}
              placeholder="https://..."
              className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy === 'identity'}
              onClick={addCapabilityCard}
            >
              <PlusIcon className="size-3.5" />
              Add
            </Button>
          </div>
          <ul className="space-y-2">
            {(data?.capability_cards ?? []).map((card) => (
              <li
                key={card.id}
                className="rounded-lg border border-border/60 bg-bg-elev/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{card.title}</span>
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-brand">
                    {card.visibility}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-fg-muted">{card.kind}</div>
              </li>
            ))}
            {(data?.capability_cards ?? []).length === 0 ? (
              <li className="text-xs text-fg-muted">No capability cards</li>
            ) : null}
          </ul>
        </div>

        <div className="rounded-lg border border-border/60 bg-bg/40 p-3 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-fg-subtle">
            Signed claims
          </div>
          <div className="grid gap-2">
            <input
              value={claimType}
              onChange={(event) => setClaimType(event.target.value)}
              placeholder="claim type"
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
            />
            <input
              value={claimValue}
              onChange={(event) => setClaimValue(event.target.value)}
              placeholder="claim value"
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
            />
            <input
              value={claimSignature}
              onChange={(event) => setClaimSignature(event.target.value)}
              placeholder="signature"
              className="rounded-lg border border-border bg-bg px-3 py-2 text-sm placeholder:text-fg-subtle focus:outline-none focus:ring-1 focus:ring-brand/40"
            />
            <div className="flex gap-2">
              <select
                value={claimVisibility}
                onChange={(event) => setClaimVisibility(event.target.value as 'public' | 'private')}
                className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand/40"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
              <Button type="button" size="sm" disabled={busy === 'claim'} onClick={addClaim}>
                Add
              </Button>
            </div>
          </div>
          <ul className="space-y-2">
            {(data?.claims ?? []).map((claim) => (
              <li key={claim.id} className="rounded-lg border border-border/60 bg-bg-elev/40 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{claim.type}</div>
                    <div className="truncate text-xs text-fg-muted">{claim.value}</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-fg-subtle hover:bg-danger/10 hover:text-danger"
                    onClick={() => revokeClaim(claim.id)}
                    disabled={busy === `claim:${claim.id}`}
                    aria-label="Revoke claim"
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
            {(data?.claims ?? []).length === 0 ? (
              <li className="text-xs text-fg-muted">No claims</li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Settled calls" value={String(data?.reputation.settled_calls ?? 0)} />
        <Metric label="Denied calls" value={String(data?.reputation.denied_calls ?? 0)} />
        <Metric label="Reputation" value={(data?.reputation.rating ?? 0).toFixed(4)} />
      </div>

      <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
          <ShieldCheckIcon className="size-3.5" />
          Operator history
        </div>
        <p className="mt-2 text-xs text-fg-muted">No delegated operator changes recorded yet.</p>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
      <div className="text-[11px] uppercase tracking-widest text-fg-subtle">{label}</div>
      <div className="mt-1 font-mono text-sm text-fg">{value}</div>
    </div>
  );
}
