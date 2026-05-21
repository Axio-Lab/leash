import {
  getAgentIdentityProfile,
  listAgentIdentityClaims,
  listAgentIdentityDomains,
  upsertAgentIdentityProfile,
  type IdentityCapabilityCard,
} from '../storage/agent-identity.js';
import { listOperatorHistory } from '../storage/operator-history.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import { execute, type DbClient } from '../storage/turso.js';

export type PublicIdentitySummary = {
  mint: string;
  network: 'solana-devnet' | 'solana-mainnet';
  handle: string | null;
  name: string;
  verified_domains: string[];
  reputation: {
    settled_calls: number;
    denied_calls: number;
    rating: number;
  };
  capability_cards_count: number;
  claims_count: number;
};

export type IdentityVerificationCheck = {
  name: string;
  passed: boolean;
  severity: 'info' | 'warn' | 'deny';
  detail: string;
};

export type IdentityVerificationDecisionWire = {
  verdict: 'allow' | 'warn' | 'deny';
  resolved_mint: string | null;
  network: 'solana-devnet' | 'solana-mainnet' | null;
  score: number;
  checks: IdentityVerificationCheck[];
  profile: PublicIdentitySummary | null;
};

export async function identityReputationSummary(db: DbClient, mint: string, network: string) {
  const res = await execute(db, `SELECT decision FROM receipts WHERE network = ? AND agent = ?`, [
    network,
    mint,
  ]);
  let settled = 0;
  let denied = 0;
  for (const row of res.rows) {
    if (String(row.decision) === 'allow') settled += 1;
    else denied += 1;
  }
  const total = settled + denied;
  const disputeRate = total === 0 ? 0 : denied / total;
  const weight = Math.min(1, Math.log10(settled + 1) / 3);
  return {
    settled_calls: settled,
    denied_calls: denied,
    rating: Number(((1 - disputeRate) * weight).toFixed(4)),
  };
}

export async function publicIdentitySummary(
  db: DbClient,
  mint: string | null | undefined,
): Promise<PublicIdentitySummary | null> {
  if (!mint) return null;
  const agent = await getPlatformAgent(db, mint);
  if (!agent) return null;
  const [profile, domains, claims, reputation] = await Promise.all([
    getAgentIdentityProfile(db, mint),
    listAgentIdentityDomains(db, mint),
    listAgentIdentityClaims(db, mint),
    identityReputationSummary(db, mint, agent.network),
  ]);
  const now = Date.now();
  const publicCards = (profile?.capabilityCards ?? []).filter(
    (card) => card.visibility === 'public',
  );
  const publicClaims = claims.filter((claim) => {
    if (claim.visibility !== 'public' || claim.revokedAt) return false;
    if (claim.expiresAt && Date.parse(claim.expiresAt) <= now) return false;
    return true;
  });
  return {
    mint: agent.mint,
    network: agent.network,
    handle: profile?.handle ?? null,
    name: agent.name,
    verified_domains: domains.filter((d) => d.status === 'verified').map((d) => d.domain),
    reputation,
    capability_cards_count: publicCards.length,
    claims_count: publicClaims.length,
  };
}

export function marketplaceCapabilityCard(args: {
  listingId: string;
  slug: string;
  name: string;
  description: string;
  endpoint: string;
  category: string;
  status: 'pending' | 'approved' | 'rejected' | 'disabled';
}): IdentityCapabilityCard {
  return {
    id: `marketplace:${args.listingId}`,
    kind: 'marketplace',
    title: args.name,
    description: args.description.slice(0, 500),
    source: 'leash',
    slug: args.slug,
    endpoint: args.endpoint,
    tags: args.category ? [args.category.slice(0, 40)] : [],
    protocols: ['x402'],
    visibility: args.status === 'approved' ? 'public' : 'private',
  };
}

export async function syncMarketplaceCapabilityCard(
  db: DbClient,
  args: {
    sellerAgentMint: string | null;
    listingId: string;
    slug: string;
    name: string;
    description: string;
    endpoint: string;
    category: string;
    status: 'pending' | 'approved' | 'rejected' | 'disabled';
  },
): Promise<void> {
  if (!args.sellerAgentMint) return;
  const agent = await getPlatformAgent(db, args.sellerAgentMint);
  if (!agent) return;
  const profile = await getAgentIdentityProfile(db, args.sellerAgentMint);
  const card = marketplaceCapabilityCard(args);
  const existing = profile?.capabilityCards ?? [];
  const next = [...existing.filter((item) => item.id !== card.id), card];
  await upsertAgentIdentityProfile(db, {
    agentMint: args.sellerAgentMint,
    network: agent.network,
    handle: profile?.handle ?? null,
    visibility: profile?.visibility ?? {},
    capabilityCards: next,
  });
}

export async function verifyMarketplaceSellerCapability(
  db: DbClient,
  args: {
    sellerAgentMint: string | null;
    endpoint: string;
    slug: string;
  },
): Promise<IdentityVerificationDecisionWire | null> {
  const profile = await publicIdentitySummary(db, args.sellerAgentMint);
  if (!profile) return null;

  const checks: IdentityVerificationCheck[] = [
    {
      name: 'selector_resolves',
      passed: true,
      severity: 'deny',
      detail: 'seller agent mint resolved',
    },
    {
      name: 'agent_exists',
      passed: true,
      severity: 'deny',
      detail: 'platform agent is active or recorded',
    },
  ];

  const identityProfile = await getAgentIdentityProfile(db, profile.mint);
  const publicCards = (identityProfile?.capabilityCards ?? []).filter(
    (card) => card.visibility === 'public',
  );
  const matched = publicCards.some(
    (card) =>
      card.kind === 'marketplace' &&
      card.slug === args.slug &&
      card.endpoint === args.endpoint &&
      card.protocols.includes('x402'),
  );
  checks.push({
    name: 'capability_match',
    passed: matched,
    severity: 'deny',
    detail: matched
      ? 'public marketplace capability card matches this listing'
      : 'no public marketplace capability card matches this listing',
  });

  checks.push({
    name: 'verified_domain',
    passed: profile.verified_domains.length > 0,
    severity: 'info',
    detail:
      profile.verified_domains.length > 0
        ? `${profile.verified_domains.length} verified domain(s)`
        : 'no verified domains on public profile',
  });

  checks.push({
    name: 'receipt_history',
    passed: profile.reputation.settled_calls > 0,
    severity: 'warn',
    detail:
      profile.reputation.settled_calls > 0
        ? `${profile.reputation.settled_calls} settled call(s)`
        : 'no settled receipt history yet',
  });

  const operatorHistory = await listOperatorHistory(db, profile.mint, { publicOnly: true });
  const latestDelegation = operatorHistory.find(
    (entry) => entry.kind === 'delegation_set' || entry.kind === 'delegation_revoke',
  );
  checks.push(
    !latestDelegation
      ? {
          name: 'operator_health',
          passed: false,
          severity: 'warn',
          detail: 'no confirmed spend delegation event is visible for this agent',
        }
      : latestDelegation.kind === 'delegation_revoke'
        ? {
            name: 'operator_health',
            passed: false,
            severity: 'deny',
            detail: 'latest public delegation event revoked spend authority',
          }
        : {
            name: 'operator_health',
            passed: true,
            severity: 'info',
            detail: 'latest public delegation event grants spend authority',
          },
  );

  const verdict = checks.some((check) => !check.passed && check.severity === 'deny')
    ? 'deny'
    : checks.some((check) => !check.passed && check.severity === 'warn')
      ? 'warn'
      : 'allow';
  const score = Math.max(
    0,
    checks.reduce((value, check) => {
      if (check.passed) return value;
      return value - (check.severity === 'deny' ? 50 : check.severity === 'warn' ? 15 : 0);
    }, 100),
  );

  return {
    verdict,
    resolved_mint: profile.mint,
    network: profile.network,
    score,
    checks,
    profile,
  };
}
