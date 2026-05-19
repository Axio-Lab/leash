'use client';

import Link from 'next/link';
import { use } from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import useSWR from 'swr';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { NEXT_PUBLIC_AGENTS_URL } from '@/lib/env';

type PaySkillsEndpoint = {
  method: string;
  path: string;
  url: string;
  description?: string;
  pricing?: {
    dimensions?: Array<{ tiers?: Array<{ price_usd?: number }> }>;
  } | null;
  protocol?: string[];
  supported_usd?: string[];
  probe_status?: string;
};

type PaySkillsProvider = {
  fqn: string;
  title: string;
  description: string;
  use_case?: string;
  category: string;
  service_url: string;
  version?: string;
  endpoints: PaySkillsEndpoint[];
};

const json = async (url: string) => {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

function endpointPrice(endpoint: PaySkillsEndpoint): string {
  const price = endpoint.pricing?.dimensions?.[0]?.tiers?.[0]?.price_usd;
  return typeof price === 'number' ? `$${price}` : 'variable';
}

export default function PaySkillsCapabilityPage({
  params,
}: {
  params: Promise<{ fqn: string[] }>;
}) {
  const { fqn } = use(params);
  const providerFqn = fqn.join('/');
  const { data, error, isLoading } = useSWR<PaySkillsProvider>(
    `/api/pay-skills/${providerFqn}`,
    json,
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (error) return <div className="text-danger">{(error as Error).message}</div>;
  if (!data) return null;

  const addHref = `${NEXT_PUBLIC_AGENTS_URL}/settings/favorites?${new URLSearchParams({
    source: 'pay-skills',
    q: data.fqn,
  }).toString()}`;

  return (
    <div className="space-y-8">
      <Link
        href="/browse"
        className="inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" /> Back to browse
      </Link>

      <article className="space-y-8">
        <header className="space-y-4 rounded-xl border bg-aurora p-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono uppercase">
              {data.category || 'pay.sh'}
            </Badge>
            <Badge variant="secondary" className="font-mono uppercase">
              pay.sh
            </Badge>
            {data.version ? <Badge variant="outline">v{data.version}</Badge> : null}
          </div>
          <h1 className="text-balance text-4xl font-semibold leading-tight tracking-tight">
            {data.title}
          </h1>
          <p className="max-w-2xl text-pretty text-fg-muted">{data.description}</p>
          <div className="flex flex-wrap items-center gap-3 pt-2 text-sm text-fg-subtle">
            <span>{data.endpoints.length} payable endpoints</span>
            <span className="font-mono">{data.fqn}</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild>
              <Link href={addHref}>Add capability</Link>
            </Button>
            <Button variant="outline" asChild>
              <a href={data.service_url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" /> Service
              </a>
            </Button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Endpoints</CardTitle>
            </CardHeader>
            <CardContent>
              {data.endpoints.length === 0 ? (
                <p className="text-sm text-fg-muted">No published endpoints.</p>
              ) : (
                <ul className="space-y-3">
                  {data.endpoints.map((endpoint, index) => (
                    <li
                      key={`${endpoint.method}-${endpoint.url}-${index}`}
                      className="rounded-lg border border-border bg-bg/40 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <span className="font-mono text-xs uppercase text-fg-muted">
                              {endpoint.method}
                            </span>
                            <span className="break-all">{endpoint.url}</span>
                          </div>
                          {endpoint.description ? (
                            <p className="mt-1 line-clamp-3 text-xs leading-snug text-fg-muted">
                              {endpoint.description}
                            </p>
                          ) : null}
                        </div>
                        <Badge variant="paid">{endpointPrice(endpoint)}</Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-fg-muted">
                        {(endpoint.protocol ?? []).map((protocol) => (
                          <span key={protocol} className="rounded bg-bg-elev px-1.5 py-0.5">
                            {protocol}
                          </span>
                        ))}
                        {(endpoint.supported_usd ?? []).map((symbol) => (
                          <span
                            key={symbol}
                            className="rounded bg-brand/10 px-1.5 py-0.5 text-brand"
                          >
                            {symbol}
                          </span>
                        ))}
                        {endpoint.probe_status ? (
                          <span className="rounded bg-fg-muted/10 px-1.5 py-0.5">
                            probe: {endpoint.probe_status}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Provider</CardTitle>
            </CardHeader>
            <CardContent>
              <code className="block break-all rounded-md border bg-bg p-3 font-mono text-xs text-fg-muted">
                {data.service_url}
              </code>
              <p className="mt-3 text-xs text-fg-subtle">
                This external pay.sh capability is read-only in Leash. Pin it to an agent identity
                from Favorites, then call its paid endpoints with buyer-kit or MCP.
              </p>
            </CardContent>
          </Card>
        </div>
      </article>
    </div>
  );
}
