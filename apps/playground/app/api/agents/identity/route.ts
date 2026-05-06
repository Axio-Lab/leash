import { NextResponse } from 'next/server';
import { fetchAsset } from '@metaplex-foundation/mpl-core';
import { getAgentIdentityStatus } from '@leashmarket/registry-utils';
import { asPublicKey, getReadOnlyUmi } from '@/lib/umi';

export const runtime = 'nodejs';

/**
 * GET /api/agents/identity?asset=<mint>
 * Returns whether the asset has an Agent Identity registered, the asset
 * signer (treasury) PDA, the registration URI from the Core asset's
 * AgentIdentity plugin (if any), and any owner info we can fetch.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const asset = url.searchParams.get('asset');
  if (!asset) {
    return NextResponse.json({ error: 'missing_asset' }, { status: 400 });
  }

  const umi = getReadOnlyUmi();
  try {
    const assetPk = asPublicKey(asset);
    const status = await getAgentIdentityStatus(umi, assetPk);

    let registrationUri: string | null = null;
    let owner: string | null = null;
    let lifecycle: { transfer?: unknown; update?: unknown; execute?: unknown } | null = null;
    try {
      const core = await fetchAsset(umi, assetPk);
      owner = String(core.owner);
      const identityPlugin = (
        core as unknown as {
          agentIdentities?: Array<{ uri?: string; lifecycleChecks?: typeof lifecycle }>;
        }
      ).agentIdentities?.[0];
      if (identityPlugin) {
        registrationUri = identityPlugin.uri ?? null;
        lifecycle = identityPlugin.lifecycleChecks ?? null;
      }
    } catch (assetErr) {
      return NextResponse.json(
        {
          error: 'asset_not_found',
          detail: assetErr instanceof Error ? assetErr.message : String(assetErr),
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      asset,
      registered: status.registered,
      treasury: status.treasury,
      registrationUri,
      lifecycleChecks: lifecycle,
      owner,
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'lookup_failed', detail: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
