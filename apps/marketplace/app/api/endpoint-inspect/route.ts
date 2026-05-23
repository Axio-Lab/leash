import { NextResponse, type NextRequest } from 'next/server';

import { requirePrivySession } from '@/lib/privy-server';

type InspectResult = {
  method: 'GET' | 'POST';
  allowed_methods: string[];
  detail: string;
};

const SAFE_TIMEOUT_MS = 5000;

export async function POST(req: NextRequest) {
  const session = await requirePrivySession(req);
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  if (!body?.url || typeof body.url !== 'string') {
    return NextResponse.json(
      { error: 'invalid_request', message: 'url is required' },
      { status: 400 },
    );
  }

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(body.url);
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Enter a valid endpoint URL.' },
      { status: 422 },
    );
  }
  if (endpointUrl.protocol !== 'https:' && endpointUrl.protocol !== 'http:') {
    return NextResponse.json(
      { error: 'invalid_request', message: 'Endpoint URL must use http or https.' },
      { status: 422 },
    );
  }

  const result = await inspectEndpoint(endpointUrl);
  return NextResponse.json(result);
}

async function inspectEndpoint(url: URL): Promise<InspectResult> {
  const options = await safeFetch(url, 'OPTIONS');
  const allow = parseAllow(options?.headers.get('allow') ?? null);
  if (allow.includes('POST')) {
    return { method: 'POST', allowed_methods: allow, detail: 'OPTIONS advertised POST.' };
  }
  if (allow.includes('GET')) {
    return { method: 'GET', allowed_methods: allow, detail: 'OPTIONS advertised GET.' };
  }

  const head = await safeFetch(url, 'HEAD');
  if (head && head.status !== 405 && head.status !== 501) {
    return {
      method: 'GET',
      allowed_methods: allow,
      detail: `HEAD returned HTTP ${head.status}; treating this as GET-compatible.`,
    };
  }

  return {
    method: 'POST',
    allowed_methods: allow,
    detail: head
      ? `HEAD returned HTTP ${head.status}; defaulting to POST.`
      : 'Could not inspect with OPTIONS or HEAD; defaulting to POST.',
  };
}

async function safeFetch(url: URL, method: 'OPTIONS' | 'HEAD'): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SAFE_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: '*/*' },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAllow(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((method) => method.trim().toUpperCase())
    .filter(Boolean);
}
