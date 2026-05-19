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
