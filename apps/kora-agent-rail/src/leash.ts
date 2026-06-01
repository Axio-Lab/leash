import { buildEnvelope, type IdentityVerifyResponse } from '@leashmarket/sdk';
import { publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { base58 } from '@metaplex-foundation/umi/serializers';

import type { CallerSelector, CallerTrust } from './types.js';

export type TrustRequest = {
  selector: CallerSelector | null;
  publicTool: boolean;
  method: string;
  pathWithQuery: string;
  bodyText: string | undefined;
  headers: Headers;
};

export type TrustAdapter = {
  verifyCaller(request: TrustRequest): Promise<CallerTrust>;
};

type PublicProfileForSignature = {
  operator_history?: Array<{ executive?: string | null }>;
};

export class LeashTrustAdapter implements TrustAdapter {
  private readonly requireSignature: boolean;
  private readonly umi = createUmi('https://api.mainnet-beta.solana.com');

  constructor(
    private readonly apiUrl: string,
    opts: { requireSignature?: boolean } = {},
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.requireSignature = opts.requireSignature ?? true;
  }

  async verifyCaller(request: TrustRequest): Promise<CallerTrust> {
    const { selector, publicTool } = request;
    if (publicTool && selector == null) {
      return {
        status: 'public',
        verified: true,
        selector: null,
        resolvedMint: null,
        detail: 'public discovery tool',
      };
    }
    if (selector == null) {
      return {
        status: 'missing',
        verified: false,
        selector: null,
        resolvedMint: null,
        detail: 'missing X-Leash-Agent, X-Leash-Handle, or X-Leash-Domain header',
      };
    }

    const params = new URLSearchParams();
    if (selector.mint) params.set('mint', selector.mint);
    if (selector.handle) params.set('handle', selector.handle);
    if (selector.domain) params.set('domain', selector.domain);

    try {
      const res = await this.fetchImpl(`${this.apiUrl}/v1/identity/verify?${params}`, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        return {
          status: 'error',
          verified: false,
          selector,
          resolvedMint: null,
          detail: `Leash verification returned HTTP ${res.status}`,
        };
      }
      const body = (await res.json()) as IdentityVerifyResponse;
      if (!body.verified) {
        return {
          status: 'denied',
          verified: false,
          selector,
          resolvedMint: body.resolved_mint,
          detail: 'Leash identity did not verify',
          raw: body,
        };
      }
      if (this.requireSignature && !publicTool) {
        const sigCheck = await this.verifySignature(request, body.resolved_mint);
        return {
          status: sigCheck.ok ? 'verified' : 'denied',
          verified: sigCheck.ok,
          selector,
          resolvedMint: body.resolved_mint,
          detail: sigCheck.detail,
          raw: body,
        };
      }
      return {
        status: 'verified',
        verified: true,
        selector,
        resolvedMint: body.resolved_mint,
        detail: 'Leash identity verified',
        raw: body,
      };
    } catch (err) {
      return {
        status: 'error',
        verified: false,
        selector,
        resolvedMint: null,
        detail: err instanceof Error ? err.message : 'Leash verification failed',
      };
    }
  }

  private async verifySignature(
    request: TrustRequest,
    resolvedMint: string | null,
  ): Promise<{ ok: boolean; detail: string }> {
    const agentMint = request.headers.get('x-leash-agent')?.trim() || resolvedMint;
    const timestamp = request.headers.get('x-leash-timestamp')?.trim();
    const sigB58 = request.headers.get('x-leash-sig')?.trim();
    if (!agentMint || !timestamp || !sigB58) {
      return {
        ok: false,
        detail: 'protected tools require X-Leash-Agent, X-Leash-Timestamp, and X-Leash-Sig',
      };
    }

    const tsMs = Date.parse(timestamp);
    if (!Number.isFinite(tsMs)) return { ok: false, detail: 'invalid X-Leash-Timestamp' };
    if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
      return { ok: false, detail: 'X-Leash-Timestamp drift exceeds 5 minutes' };
    }

    const executives = await this.executivesFor(agentMint);
    if (executives.length === 0) {
      return { ok: false, detail: 'Leash profile has no public executive key to verify against' };
    }

    let sigBytes: Uint8Array;
    try {
      sigBytes = base58.serialize(sigB58);
    } catch {
      return { ok: false, detail: 'X-Leash-Sig is not valid base58' };
    }
    if (sigBytes.length !== 64) return { ok: false, detail: 'X-Leash-Sig must be 64 bytes' };

    const envelope = await buildEnvelope({
      method: request.method,
      pathWithQuery: request.pathWithQuery,
      timestamp,
      body: request.bodyText,
      agentMint,
    });

    for (const executive of executives) {
      try {
        if (this.umi.eddsa.verify(envelope, sigBytes, publicKey(executive))) {
          return { ok: true, detail: 'Leash identity and X-Leash-Sig verified' };
        }
      } catch {
        continue;
      }
    }
    return { ok: false, detail: 'X-Leash-Sig does not verify for this agent' };
  }

  private async executivesFor(mint: string): Promise<string[]> {
    const params = new URLSearchParams({ mint });
    const res = await this.fetchImpl(`${this.apiUrl}/v1/identity/resolve?${params}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return [];
    const profile = (await res.json()) as PublicProfileForSignature;
    return [
      ...new Set(
        (profile.operator_history ?? [])
          .map((entry) => entry.executive)
          .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
      ),
    ];
  }
}

export class DemoTrustAdapter implements TrustAdapter {
  async verifyCaller({ selector, publicTool }: TrustRequest): Promise<CallerTrust> {
    if (selector == null && !publicTool) {
      return {
        status: 'missing',
        verified: false,
        selector,
        resolvedMint: null,
        detail: 'missing caller identity',
      };
    }
    return {
      status: selector == null ? 'public' : 'verified',
      verified: true,
      selector,
      resolvedMint: selector?.mint ?? null,
      detail: selector == null ? 'public discovery tool' : 'demo trust adapter accepted caller',
    };
  }
}
