'use client';

import * as React from 'react';
import type {
  IdentityCapabilityCard as CapabilityCard,
  // IdentityDisclosureGrant as DisclosureGrant,
  // OperatorHistoryEntry,
  PublicIdentityProfile as IdentityProfile,
} from '@leashmarket/schemas';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  BadgeCheckIcon,
  GlobeIcon,
  IdCardIcon,
  // LinkIcon,
  // PlusIcon,
  // ShieldCheckIcon,
  // Trash2Icon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { NEXT_PUBLIC_MARKETPLACE_URL } from '@/lib/env';

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

// const disclosureFetcher = async (url: string): Promise<{ items: DisclosureGrant[] }> => {
//   const res = await fetch(url, { credentials: 'include' });
//   const json = await res.json().catch(() => null);
//   if (!res.ok) {
//     const message =
//       json && typeof json === 'object' && 'message' in json
//         ? String(json.message)
//         : `HTTP ${res.status}`;
//     throw new Error(message);
//   }
//   return json as { items: DisclosureGrant[] };
// };

export function IdentityProfilePanel({ agentMint }: { agentMint: string }) {
  const verifyDomainGuideHref = `${NEXT_PUBLIC_MARKETPLACE_URL}/blog/how-to-verify-an-agent-domain-on-leash`;
  const { data, error, isLoading, mutate } = useSWR<IdentityProfile>(
    `/api/agents/${agentMint}/identity`,
    fetcher,
    { revalidateOnFocus: false },
  );
  // const { data: disclosureData, mutate: mutateDisclosures } = useSWR<{ items: DisclosureGrant[] }>(
  //   `/api/agents/${agentMint}/identity/disclosures`,
  //   disclosureFetcher,
  //   { revalidateOnFocus: false },
  // );
  const [handle, setHandle] = React.useState('');
  const [domain, setDomain] = React.useState('');
  // const [cardTitle, setCardTitle] = React.useState('');
  // const [cardEndpoint, setCardEndpoint] = React.useState('');
  // const [cardKind, setCardKind] = React.useState<CapabilityCard['kind']>('custom');
  // const [cardVisibility, setCardVisibility] = React.useState<'public' | 'private'>('public');
  // const [claimType, setClaimType] = React.useState('');
  // const [claimValue, setClaimValue] = React.useState('');
  // const [claimSignature, setClaimSignature] = React.useState('');
  // const [claimVisibility, setClaimVisibility] = React.useState<'public' | 'private'>('public');
  // const [disclosureReceiptHash, setDisclosureReceiptHash] = React.useState('');
  // const [lastDisclosureUrl, setLastDisclosureUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (data?.handle) setHandle(data.handle);
  }, [data?.handle]);

  async function saveIdentity(
    next: {
      handle?: string | null;
      capability_cards?: Omit<CapabilityCard, 'id'>[] | CapabilityCard[];
    },
    busyKey = 'identity',
  ): Promise<boolean> {
    setBusy(busyKey);
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
      return true;
    } catch (err) {
      toast.error('Identity update failed', { description: (err as Error).message });
      return false;
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

  // async function addCapabilityCard() {
  //   if (!cardTitle.trim()) return;
  //   const current = data?.capability_cards ?? [];
  //   const next = [
  //     ...current,
  //     {
  //       kind: cardKind,
  //       title: cardTitle.trim(),
  //       ...(cardEndpoint.trim() ? { endpoint: cardEndpoint.trim() } : {}),
  //       source: 'manual' as const,
  //       tags: [],
  //       protocols: [],
  //       visibility: cardVisibility,
  //     },
  //   ];
  //   const saved = await saveIdentity({ capability_cards: next }, 'card');
  //   if (saved) {
  //     setCardTitle('');
  //     setCardEndpoint('');
  //     setCardKind('custom');
  //     setCardVisibility('public');
  //   }
  // }

  // async function addClaim() {
  //   if (!claimType.trim() || !claimValue.trim() || !claimSignature.trim()) return;
  //   setBusy('claim');
  //   try {
  //     const res = await fetch(`/api/agents/${agentMint}/identity/claims`, {
  //       method: 'POST',
  //       credentials: 'include',
  //       headers: { 'content-type': 'application/json' },
  //       body: JSON.stringify({
  //         issuer: 'owner',
  //         type: claimType.trim(),
  //         value: claimValue.trim(),
  //         signature: claimSignature.trim(),
  //         visibility: claimVisibility,
  //       }),
  //     });
  //     const json = await res.json().catch(() => null);
  //     if (!res.ok) throw new Error(json?.message ?? json?.detail ?? `HTTP ${res.status}`);
  //     toast.success('Claim saved');
  //     setClaimType('');
  //     setClaimValue('');
  //     setClaimSignature('');
  //     setClaimVisibility('public');
  //     await mutate();
  //   } catch (err) {
  //     toast.error('Claim save failed', { description: (err as Error).message });
  //   } finally {
  //     setBusy(null);
  //   }
  // }

  // async function revokeClaim(id: string) {
  //   setBusy(`claim:${id}`);
  //   try {
  //     const res = await fetch(`/api/agents/${agentMint}/identity/claims/${id}`, {
  //       method: 'DELETE',
  //       credentials: 'include',
  //     });
  //     if (!res.ok) {
  //       const json = await res.json().catch(() => null);
  //       throw new Error(json?.message ?? json?.detail ?? `HTTP ${res.status}`);
  //     }
  //     toast.success('Claim revoked');
  //     await mutate();
  //   } catch (err) {
  //     toast.error('Claim revoke failed', { description: (err as Error).message });
  //   } finally {
  //     setBusy(null);
  //   }
  // }

  // async function createDisclosure(resources: DisclosureGrant['resources']) {
  //   setBusy('disclosure');
  //   try {
  //     const res = await fetch(`/api/agents/${agentMint}/identity/disclosures`, {
  //       method: 'POST',
  //       credentials: 'include',
  //       headers: { 'content-type': 'application/json' },
  //       body: JSON.stringify({ resources }),
  //     });
  //     const json = await res.json().catch(() => null);
  //     if (!res.ok) throw new Error(json?.message ?? json?.detail ?? `HTTP ${res.status}`);
  //     setLastDisclosureUrl(String(json.url));
  //     toast.success('Disclosure link created');
  //     await mutateDisclosures();
  //   } catch (err) {
  //     toast.error('Disclosure create failed', { description: (err as Error).message });
  //   } finally {
  //     setBusy(null);
  //   }
  // }

  // async function revokeDisclosure(id: string) {
  //   setBusy(`disclosure:${id}`);
  //   try {
  //     const res = await fetch(`/api/agents/${agentMint}/identity/disclosures/${id}`, {
  //       method: 'DELETE',
  //       credentials: 'include',
  //     });
  //     if (!res.ok) {
  //       const json = await res.json().catch(() => null);
  //       throw new Error(json?.message ?? json?.detail ?? `HTTP ${res.status}`);
  //     }
  //     toast.success('Disclosure revoked');
  //     await mutateDisclosures();
  //   } catch (err) {
  //     toast.error('Disclosure revoke failed', { description: (err as Error).message });
  //   } finally {
  //     setBusy(null);
  //   }
  // }

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
          <p className="text-xs leading-relaxed text-fg-muted">
            A handle is the readable name buyers can use instead of a raw mint address. You can
            claim one, edit it later, and save the new value as long as no other agent already owns
            it.
          </p>
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
              onClick={() => void saveIdentity({ handle: handle.trim() || null })}
            >
              {busy === 'identity' ? (
                <>
                  <Spinner size="xs" />
                  Saving
                </>
              ) : (
                'Save'
              )}
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
          <p className="text-xs leading-relaxed text-fg-muted">
            Verified domains prove this agent controls a website. Add a domain after publishing
            `/.well-known/leash-agent.json` with this agent mint and network.{' '}
            <a
              href={verifyDomainGuideHref}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand hover:text-brand-strong hover:underline"
            >
              How to verify domain
            </a>
            .
          </p>
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
              {busy === 'domain' ? (
                <>
                  <Spinner size="xs" />
                  Verifying
                </>
              ) : (
                'Verify'
              )}
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

      {/* <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-fg-subtle">
          <ShieldCheckIcon className="size-3.5" />
          Operator history
        </div>
        {(data?.operator_history ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-fg-muted">No delegated operator changes recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data!.operator_history.map((entry) => (
              <li
                key={entry.event_id}
                className="rounded-lg border border-border/60 bg-bg-elev/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{operatorHistoryLabel(entry.kind)}</span>
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-brand">
                    {entry.phase}
                  </span>
                </div>
                <div className="mt-1 grid gap-1 text-[11px] text-fg-muted sm:grid-cols-2">
                  {entry.delegate ? <span>Delegate {shortAddress(entry.delegate)}</span> : null}
                  {entry.executive ? <span>Executive {shortAddress(entry.executive)}</span> : null}
                  {entry.token_mint ? <span>Mint {shortAddress(entry.token_mint)}</span> : null}
                  {entry.delegated_amount ? <span>Amount {entry.delegated_amount}</span> : null}
                  {entry.signature ? <span>Tx {shortAddress(entry.signature)}</span> : null}
                  <span>{new Date(entry.created_at).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div> */}
    </section>
  );
}

// function operatorHistoryLabel(kind: OperatorHistoryEntry['kind']): string {
//   switch (kind) {
//     case 'executive_register':
//       return 'Executive registered';
//     case 'executive_delegate':
//       return 'Executive delegated';
//     case 'delegation_set':
//       return 'Spend delegation set';
//     case 'delegation_revoke':
//       return 'Spend delegation revoked';
//   }
// }

// function shortAddress(value: string): string {
//   return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
// }

// function Metric({ label, value }: { label: string; value: string }) {
//   return (
//     <div className="rounded-lg border border-border/60 bg-bg/40 p-3">
//       <div className="text-[11px] uppercase tracking-widest text-fg-subtle">{label}</div>
//       <div className="mt-1 font-mono text-sm text-fg">{value}</div>
//     </div>
//   );
// }
