export type IdentitySelector = {
  mint?: string;
  handle?: string;
  domain?: string;
};

export type IdentityVerifyResponse = {
  verified: boolean;
  resolved_mint: string | null;
  network: 'solana-devnet' | 'solana-mainnet' | null;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
};

export type IdentityVerificationDecisionRequest = {
  selector?: IdentitySelector;
  mint?: string;
  handle?: string;
  domain?: string;
  intent?: 'pay' | 'call_capability' | 'trust_claim' | 'inspect';
  capability?: {
    kind?: string;
    slug?: string;
    endpoint?: string;
    protocol?: 'x402' | 'mpp';
  };
  thresholds?: {
    min_rating?: number;
    required_claim_types?: string[];
    require_verified_domain?: boolean;
  };
};

export type IdentityVerificationDecision = {
  verdict: 'allow' | 'warn' | 'deny';
  resolved_mint: string | null;
  network: 'solana-devnet' | 'solana-mainnet' | null;
  score: number;
  checks: Array<{
    name: string;
    passed: boolean;
    severity: 'info' | 'warn' | 'deny';
    detail: string;
  }>;
  profile: unknown;
};

export async function verifyAgentIdentity(args: {
  apiBaseUrl?: string;
  selector: IdentitySelector;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<IdentityVerifyResponse> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const params = new URLSearchParams();
  if (args.selector.mint) params.set('mint', args.selector.mint);
  if (args.selector.handle) params.set('handle', args.selector.handle);
  if (args.selector.domain) params.set('domain', args.selector.domain);
  const base = (args.apiBaseUrl ?? 'https://api.leash.market').replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/v1/identity/verify?${params}`);
  if (!res.ok) throw new Error(`identity verify failed: HTTP ${res.status}`);
  return res.json() as Promise<IdentityVerifyResponse>;
}

export async function verifyAgentIdentityDecision(args: {
  apiBaseUrl?: string;
  request: IdentityVerificationDecisionRequest;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<IdentityVerificationDecision> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const base = (args.apiBaseUrl ?? 'https://api.leash.market').replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/v1/identity/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args.request),
  });
  if (!res.ok) throw new Error(`identity decision failed: HTTP ${res.status}`);
  return res.json() as Promise<IdentityVerificationDecision>;
}
