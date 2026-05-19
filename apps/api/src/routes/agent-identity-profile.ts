import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { createHash, randomBytes } from 'node:crypto';
import { ulid } from 'ulid';

import { adminAuth } from '../auth/admin.js';
import type { LeashApiConfig } from '../config.js';
import { ApiErrorSchema, NetworkSchema, PubkeySchema } from '../openapi/common.js';
import {
  createAgentIdentityClaim,
  getAgentIdentityClaim,
  getAgentIdentityDomain,
  getAgentIdentityProfile,
  getAgentIdentityProfileByHandle,
  listAgentIdentityClaims,
  listAgentIdentityDomains,
  revokeAgentIdentityClaim,
  upsertAgentIdentityDomain,
  upsertAgentIdentityProfile,
  type IdentityCapabilityCard,
} from '../storage/agent-identity.js';
import {
  createIdentityDisclosure,
  getIdentityDisclosure,
  getIdentityDisclosureByTokenHash,
  listIdentityDisclosures,
  revokeIdentityDisclosure,
  type IdentityDisclosureGrant,
  type IdentityDisclosureResource,
} from '../storage/identity-disclosures.js';
import { listOperatorHistory, type OperatorHistoryRow } from '../storage/operator-history.js';
import { getPlatformAgent } from '../storage/platform-agents.js';
import { getReceiptByHash } from '../storage/receipts.js';
import type { CacheClient } from '../storage/redis.js';
import { execute, type DbClient } from '../storage/turso.js';
import { conflict, invalidRequest, notFound } from '../util/errors.js';
import type { SvmNetwork } from '../util/network.js';

export type AgentIdentityProfileDeps = {
  config: LeashApiConfig;
  db: DbClient;
  cache: CacheClient;
  fetchImpl?: typeof globalThis.fetch;
};

const HandleSchema = z
  .string()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9][a-z0-9_-]*$/, 'handle must start with a letter/number');

const CapabilityCardSchema = z
  .object({
    id: z.string().min(1).optional(),
    kind: z.enum([
      'seller_api',
      'buyer_tool',
      'data_source',
      'control_channel',
      'automation',
      'marketplace',
      'pay_skills',
      'custom',
    ]),
    title: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    source: z.enum(['leash', 'pay-skills', 'manual', 'connection', 'automation']).optional(),
    slug: z.string().max(200).optional(),
    endpoint: z.string().url().max(800).optional(),
    tags: z.array(z.string().min(1).max(40)).default([]),
    protocols: z.array(z.enum(['x402', 'mpp'])).default([]),
    visibility: z.enum(['public', 'private']).default('public'),
  })
  .openapi('IdentityCapabilityCard');

const ClaimSchema = z
  .object({
    id: z.string(),
    issuer: z.string(),
    subject_mint: PubkeySchema,
    type: z.string(),
    value: z.string(),
    evidence_url: z.string().nullable(),
    signature: z.string(),
    visibility: z.enum(['public', 'private']),
    expires_at: z.string().nullable(),
    revoked_at: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('IdentityClaim');

const OperatorHistorySchema = z
  .object({
    event_id: z.string(),
    kind: z.enum([
      'executive_register',
      'executive_delegate',
      'delegation_set',
      'delegation_revoke',
    ]),
    phase: z.enum(['prepared', 'submitted', 'confirmed', 'failed']),
    actor: z.string().nullable(),
    delegate: PubkeySchema.nullable(),
    executive: PubkeySchema.nullable(),
    token_mint: PubkeySchema.nullable(),
    source_token_account: PubkeySchema.nullable(),
    delegated_amount: z.string().nullable(),
    signature: z.string().nullable(),
    event_source: z.string(),
    created_at: z.string(),
    confirmed_at: z.string().nullable(),
    failed_at: z.string().nullable(),
  })
  .openapi('OperatorHistoryEntry');

const PublicIdentityProfileSchema = z
  .object({
    mint: PubkeySchema,
    network: NetworkSchema,
    handle: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    image_url: z.string().nullable(),
    treasury: PubkeySchema,
    services: z.array(z.object({ name: z.string(), endpoint: z.string() })),
    verified_domains: z.array(z.string()),
    capability_cards: z.array(CapabilityCardSchema),
    claims: z.array(ClaimSchema),
    operator_history: z.array(OperatorHistorySchema),
    reputation: z.object({
      settled_calls: z.number().int(),
      denied_calls: z.number().int(),
      rating: z.number(),
    }),
  })
  .openapi('PublicAgentIdentityProfile');

const VerifyResponseSchema = z
  .object({
    verified: z.boolean(),
    resolved_mint: PubkeySchema.nullable(),
    network: NetworkSchema.nullable(),
    checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })),
  })
  .openapi('AgentIdentityVerifyResponse');

const IdentitySelectorSchema = z
  .object({
    mint: PubkeySchema.optional(),
    handle: z.string().optional(),
    domain: z.string().optional(),
  })
  .refine((value) => [value.mint, value.handle, value.domain].filter(Boolean).length === 1, {
    message: 'provide exactly one of: mint, handle, domain',
  });

const VerificationIntentSchema = z.enum(['pay', 'call_capability', 'trust_claim', 'inspect']);

const VerificationCapabilitySchema = z.object({
  kind: CapabilityCardSchema.shape.kind.optional(),
  slug: z.string().max(200).optional(),
  endpoint: z.string().url().max(800).optional(),
  protocol: z.enum(['x402', 'mpp']).optional(),
});

const VerificationThresholdsSchema = z.object({
  min_rating: z.number().min(0).max(1).optional(),
  required_claim_types: z.array(z.string().min(1).max(120)).default([]),
  require_verified_domain: z.boolean().default(false),
});

const VerificationDecisionRequestSchema = z
  .object({
    selector: IdentitySelectorSchema.optional(),
    mint: PubkeySchema.optional(),
    handle: z.string().optional(),
    domain: z.string().optional(),
    intent: VerificationIntentSchema.default('inspect'),
    capability: VerificationCapabilitySchema.optional(),
    thresholds: VerificationThresholdsSchema.default({}),
  })
  .refine(
    (value) =>
      value.selector != null ||
      [value.mint, value.handle, value.domain].filter(Boolean).length === 1,
    'provide selector or exactly one top-level mint, handle, domain',
  );

const VerificationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  severity: z.enum(['info', 'warn', 'deny']),
  detail: z.string(),
});

const VerificationDecisionResponseSchema = z
  .object({
    verdict: z.enum(['allow', 'warn', 'deny']),
    resolved_mint: PubkeySchema.nullable(),
    network: NetworkSchema.nullable(),
    score: z.number().min(0).max(100),
    checks: z.array(VerificationCheckSchema),
    profile: z
      .object({
        mint: PubkeySchema,
        handle: z.string().nullable(),
        name: z.string(),
        verified_domains: z.array(z.string()),
        reputation: z.object({
          settled_calls: z.number().int(),
          denied_calls: z.number().int(),
          rating: z.number(),
        }),
        capability_cards_count: z.number().int(),
        claims_count: z.number().int(),
      })
      .nullable(),
  })
  .openapi('AgentIdentityVerificationDecision');

const DisclosureResourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('capability_card'), id: z.string().min(1) }),
  z.object({ kind: z.literal('claim'), id: z.string().min(1) }),
  z.object({
    kind: z.literal('receipt'),
    receipt_hash: z.string().min(16).max(128),
    fields: z.array(z.enum(['summary', 'request', 'price', 'response', 'tx'])).optional(),
  }),
]);

const DisclosureGrantSchema = z.object({
  id: z.string(),
  agent_mint: PubkeySchema,
  network: NetworkSchema,
  resources: z.array(DisclosureResourceSchema),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});

const CreateDisclosureResponseSchema = DisclosureGrantSchema.extend({
  token: z.string(),
  url: z.string(),
});

const DisclosureReadResponseSchema = z
  .object({
    id: z.string(),
    agent: z.object({
      mint: PubkeySchema,
      network: NetworkSchema,
      handle: z.string().nullable(),
      name: z.string(),
    }),
    expires_at: z.string(),
    resources: z.object({
      capability_cards: z.array(CapabilityCardSchema),
      claims: z.array(ClaimSchema),
      receipts: z.array(z.record(z.unknown())),
    }),
  })
  .openapi('IdentityDisclosureRead');

function normalizeHandle(input: string): string {
  const handle = input.trim().replace(/^@+/, '').toLowerCase();
  const parsed = HandleSchema.safeParse(handle);
  if (!parsed.success) throw invalidRequest('invalid handle', parsed.error.flatten());
  return handle;
}

function normalizeDomain(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) throw invalidRequest('domain is required');
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (!url.hostname || url.hostname.includes('_')) throw new Error('bad hostname');
    return url.hostname;
  } catch {
    throw invalidRequest('invalid domain');
  }
}

function cardToWire(card: IdentityCapabilityCard) {
  return {
    id: card.id,
    kind: card.kind,
    title: card.title,
    ...(card.description ? { description: card.description } : {}),
    ...(card.source ? { source: card.source } : {}),
    ...(card.slug ? { slug: card.slug } : {}),
    ...(card.endpoint ? { endpoint: card.endpoint } : {}),
    tags: card.tags,
    protocols: card.protocols,
    visibility: card.visibility,
  };
}

function operatorHistoryToWire(row: OperatorHistoryRow, opts: { publicView?: boolean } = {}) {
  const actor = opts.publicView && row.actor?.startsWith('api_key:') ? null : row.actor;
  return {
    event_id: row.eventId,
    kind: row.kind,
    phase: row.phase,
    actor,
    delegate: row.delegate,
    executive: row.executive,
    token_mint: row.tokenMint,
    source_token_account: row.sourceTokenAccount,
    delegated_amount: row.delegatedAmount,
    signature: row.signature,
    event_source: row.eventSource,
    created_at: row.createdAt,
    confirmed_at: row.confirmedAt,
    failed_at: row.failedAt,
  };
}

async function reputationSummary(db: DbClient, mint: string, network: SvmNetwork) {
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

async function publicProfile(db: DbClient, mint: string) {
  const agent = await getPlatformAgent(db, mint);
  if (!agent) throw notFound('agent identity not found');
  const [profile, domains, claims, reputation, operatorHistory] = await Promise.all([
    getAgentIdentityProfile(db, mint),
    listAgentIdentityDomains(db, mint),
    listAgentIdentityClaims(db, mint),
    reputationSummary(db, mint, agent.network),
    listOperatorHistory(db, mint, { publicOnly: true }),
  ]);
  const now = Date.now();
  return {
    mint: agent.mint,
    network: agent.network,
    handle: profile?.handle ?? null,
    name: agent.name,
    description: agent.description,
    image_url: agent.imageUrl,
    treasury: agent.treasury,
    services: agent.services,
    verified_domains: domains.filter((d) => d.status === 'verified').map((d) => d.domain),
    capability_cards: (profile?.capabilityCards ?? [])
      .filter((card) => card.visibility === 'public')
      .map(cardToWire),
    claims: claims
      .filter((claim) => {
        if (claim.visibility !== 'public' || claim.revokedAt) return false;
        if (claim.expiresAt && Date.parse(claim.expiresAt) <= now) return false;
        return true;
      })
      .map((claim) => ({
        id: claim.id,
        issuer: claim.issuer,
        subject_mint: claim.subjectMint,
        type: claim.type,
        value: claim.value,
        evidence_url: claim.evidenceUrl,
        signature: claim.signature,
        visibility: claim.visibility,
        expires_at: claim.expiresAt,
        revoked_at: claim.revokedAt,
        created_at: claim.createdAt,
      })),
    operator_history: operatorHistory.map((row) =>
      operatorHistoryToWire(row, { publicView: true }),
    ),
    reputation,
  };
}

async function adminProfile(db: DbClient, mint: string) {
  const agent = await getPlatformAgent(db, mint);
  if (!agent) throw notFound('agent identity not found');
  const [profile, domains, claims, reputation, operatorHistory] = await Promise.all([
    getAgentIdentityProfile(db, mint),
    listAgentIdentityDomains(db, mint),
    listAgentIdentityClaims(db, mint),
    reputationSummary(db, mint, agent.network),
    listOperatorHistory(db, mint),
  ]);
  return {
    mint: agent.mint,
    network: agent.network,
    handle: profile?.handle ?? null,
    name: agent.name,
    description: agent.description,
    image_url: agent.imageUrl,
    treasury: agent.treasury,
    services: agent.services,
    verified_domains: domains.filter((d) => d.status === 'verified').map((d) => d.domain),
    capability_cards: (profile?.capabilityCards ?? []).map(cardToWire),
    claims: claims
      .filter((claim) => !claim.revokedAt)
      .map((claim) => ({
        id: claim.id,
        issuer: claim.issuer,
        subject_mint: claim.subjectMint,
        type: claim.type,
        value: claim.value,
        evidence_url: claim.evidenceUrl,
        signature: claim.signature,
        visibility: claim.visibility,
        expires_at: claim.expiresAt,
        revoked_at: claim.revokedAt,
        created_at: claim.createdAt,
      })),
    operator_history: operatorHistory.map((row) => operatorHistoryToWire(row)),
    reputation,
  };
}

type PublicProfile = Awaited<ReturnType<typeof publicProfile>>;
type VerificationCheck = z.infer<typeof VerificationCheckSchema>;

function resolveDecisionSelector(body: z.infer<typeof VerificationDecisionRequestSchema>) {
  return body.selector ?? { mint: body.mint, handle: body.handle, domain: body.domain };
}

function capabilityMatches(
  card: PublicProfile['capability_cards'][number],
  capability: z.infer<typeof VerificationCapabilitySchema>,
): boolean {
  if (capability.kind && card.kind !== capability.kind) return false;
  if (capability.slug && card.slug !== capability.slug) return false;
  if (capability.endpoint && card.endpoint !== capability.endpoint) return false;
  if (capability.protocol && !card.protocols.includes(capability.protocol)) return false;
  return true;
}

function operatorHealthCheck(
  profile: PublicProfile,
  intent: z.infer<typeof VerificationIntentSchema>,
): VerificationCheck {
  const requiresSpendDelegation = intent === 'pay' || intent === 'call_capability';
  if (!requiresSpendDelegation) {
    return {
      name: 'operator_health',
      passed: true,
      severity: 'info',
      detail: 'operator delegation is not required for this intent',
    };
  }
  const delegationEvents = profile.operator_history.filter(
    (entry) => entry.kind === 'delegation_set' || entry.kind === 'delegation_revoke',
  );
  if (delegationEvents.length === 0) {
    return {
      name: 'operator_health',
      passed: false,
      severity: 'warn',
      detail: 'no confirmed spend delegation event is visible for this agent',
    };
  }
  const latest = delegationEvents[0]!;
  if (latest.kind === 'delegation_revoke') {
    return {
      name: 'operator_health',
      passed: false,
      severity: 'deny',
      detail: 'latest public delegation event revoked spend authority',
    };
  }
  return {
    name: 'operator_health',
    passed: true,
    severity: 'info',
    detail: 'latest public delegation event grants spend authority',
  };
}

function verdictFromChecks(checks: VerificationCheck[]): 'allow' | 'warn' | 'deny' {
  if (checks.some((check) => !check.passed && check.severity === 'deny')) return 'deny';
  if (checks.some((check) => !check.passed && check.severity === 'warn')) return 'warn';
  return 'allow';
}

function scoreFromChecks(checks: VerificationCheck[]): number {
  let score = 100;
  for (const check of checks) {
    if (check.passed) continue;
    score -= check.severity === 'deny' ? 50 : check.severity === 'warn' ? 15 : 0;
  }
  return Math.max(0, score);
}

async function verificationDecision(
  db: DbClient,
  body: z.infer<typeof VerificationDecisionRequestSchema>,
) {
  const selector = resolveDecisionSelector(body);
  const checks: VerificationCheck[] = [];
  let mint: string;
  try {
    mint = await resolveMint(db, selector);
    checks.push({
      name: 'selector_resolves',
      passed: true,
      severity: 'deny',
      detail: 'selector resolved to an agent mint',
    });
  } catch (err) {
    checks.push({
      name: 'selector_resolves',
      passed: false,
      severity: 'deny',
      detail: err instanceof Error ? err.message : 'selector did not resolve',
    });
    return {
      verdict: 'deny' as const,
      resolved_mint: null,
      network: null,
      score: scoreFromChecks(checks),
      checks,
      profile: null,
    };
  }

  const agent = await getPlatformAgent(db, mint);
  checks.push({
    name: 'agent_exists',
    passed: agent != null,
    severity: 'deny',
    detail: agent ? 'platform agent is active or recorded' : 'agent row not found',
  });
  if (!agent) {
    return {
      verdict: 'deny' as const,
      resolved_mint: mint,
      network: null,
      score: scoreFromChecks(checks),
      checks,
      profile: null,
    };
  }

  const profile = await publicProfile(db, mint);
  const thresholds = body.thresholds;
  const requiredClaimTypes = thresholds.required_claim_types ?? [];
  const requireVerifiedDomain =
    thresholds.require_verified_domain === true || selector.domain != null;

  checks.push({
    name: 'verified_domain',
    passed: !requireVerifiedDomain || profile.verified_domains.length > 0,
    severity: requireVerifiedDomain ? 'deny' : 'info',
    detail:
      profile.verified_domains.length > 0
        ? `${profile.verified_domains.length} verified domain(s)`
        : 'no verified domains on public profile',
  });

  if (requiredClaimTypes.length > 0) {
    const claimTypes = new Set(profile.claims.map((claim) => claim.type));
    const missing = requiredClaimTypes.filter((type) => !claimTypes.has(type));
    checks.push({
      name: 'required_claims',
      passed: missing.length === 0,
      severity: 'deny',
      detail:
        missing.length === 0
          ? 'all required public claims are present'
          : `missing required claim(s): ${missing.join(', ')}`,
    });
  }

  if (body.capability) {
    const matched = profile.capability_cards.some((card) =>
      capabilityMatches(card, body.capability!),
    );
    checks.push({
      name: 'capability_match',
      passed: matched,
      severity: body.intent === 'call_capability' || body.intent === 'pay' ? 'deny' : 'warn',
      detail: matched
        ? 'public capability card matches requested requirement'
        : 'no public capability card matches requested requirement',
    });
  }

  if (thresholds.min_rating != null) {
    checks.push({
      name: 'reputation_threshold',
      passed: profile.reputation.rating >= thresholds.min_rating,
      severity: 'deny',
      detail: `rating ${profile.reputation.rating.toFixed(4)} vs required ${thresholds.min_rating.toFixed(4)}`,
    });
  } else if (body.intent === 'pay' || body.intent === 'call_capability') {
    checks.push({
      name: 'receipt_history',
      passed: profile.reputation.settled_calls > 0,
      severity: 'warn',
      detail:
        profile.reputation.settled_calls > 0
          ? `${profile.reputation.settled_calls} settled call(s)`
          : 'no settled receipt history yet',
    });
  }

  checks.push(operatorHealthCheck(profile, body.intent));

  return {
    verdict: verdictFromChecks(checks),
    resolved_mint: profile.mint,
    network: profile.network,
    score: scoreFromChecks(checks),
    checks,
    profile: {
      mint: profile.mint,
      handle: profile.handle,
      name: profile.name,
      verified_domains: profile.verified_domains,
      reputation: profile.reputation,
      capability_cards_count: profile.capability_cards.length,
      claims_count: profile.claims.length,
    },
  };
}

function hashDisclosureToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newDisclosureToken(): string {
  return randomBytes(32).toString('base64url');
}

function grantToWire(grant: IdentityDisclosureGrant) {
  return {
    id: grant.id,
    agent_mint: grant.agentMint,
    network: grant.network,
    resources: grant.resources,
    expires_at: grant.expiresAt,
    revoked_at: grant.revokedAt,
    created_at: grant.createdAt,
  };
}

function disclosureExpiry(input?: string | null): string {
  const now = Date.now();
  const max = now + 90 * 24 * 60 * 60 * 1000;
  const fallback = now + 7 * 24 * 60 * 60 * 1000;
  const requested = input ? Date.parse(input) : fallback;
  if (!Number.isFinite(requested) || requested <= now) {
    throw invalidRequest('expires_at must be a future ISO timestamp');
  }
  if (requested > max) throw invalidRequest('expires_at cannot be more than 90 days out');
  return new Date(requested).toISOString();
}

function redactReceipt(
  receipt: Record<string, unknown>,
  fields: Array<'summary' | 'request' | 'price' | 'response' | 'tx'>,
) {
  const out: Record<string, unknown> = {
    receipt_hash: receipt.receipt_hash,
    kind: receipt.kind,
    decision: receipt.decision,
    ts: receipt.ts,
  };
  const selected = new Set(fields.length > 0 ? fields : ['summary']);
  if (selected.has('request')) out.request = receipt.request;
  if (selected.has('price')) out.price = receipt.price;
  if (selected.has('response')) out.response = receipt.response;
  if (selected.has('tx')) {
    out.tx_sig = receipt.tx_sig;
    out.mpp_settlement_tx = receipt.mpp_settlement_tx;
  }
  return out;
}

async function readDisclosure(db: DbClient, token: string) {
  const grant = await getIdentityDisclosureByTokenHash(db, hashDisclosureToken(token));
  if (!grant || grant.revokedAt) throw notFound('disclosure not found');
  if (Date.parse(grant.expiresAt) <= Date.now()) throw notFound('disclosure not found');

  const agent = await getPlatformAgent(db, grant.agentMint);
  if (!agent) throw notFound('agent identity not found');
  const [profile, claims] = await Promise.all([
    getAgentIdentityProfile(db, grant.agentMint),
    listAgentIdentityClaims(db, grant.agentMint),
  ]);
  const cards = profile?.capabilityCards ?? [];
  const now = Date.now();

  const capabilityIds = new Set(
    grant.resources
      .filter(
        (resource): resource is Extract<IdentityDisclosureResource, { kind: 'capability_card' }> =>
          resource.kind === 'capability_card',
      )
      .map((resource) => resource.id),
  );
  const claimIds = new Set(
    grant.resources
      .filter(
        (resource): resource is Extract<IdentityDisclosureResource, { kind: 'claim' }> =>
          resource.kind === 'claim',
      )
      .map((resource) => resource.id),
  );
  const receiptResources = grant.resources.filter(
    (resource): resource is Extract<IdentityDisclosureResource, { kind: 'receipt' }> =>
      resource.kind === 'receipt',
  );

  const disclosedReceipts: Record<string, unknown>[] = [];
  for (const resource of receiptResources) {
    const row = await getReceiptByHash(db, grant.network, resource.receipt_hash);
    if (!row || row.agent !== grant.agentMint) continue;
    disclosedReceipts.push(
      redactReceipt(row.raw as Record<string, unknown>, resource.fields ?? []),
    );
  }

  const identityProfile = await getAgentIdentityProfile(db, grant.agentMint);
  return {
    id: grant.id,
    agent: {
      mint: agent.mint,
      network: agent.network,
      handle: identityProfile?.handle ?? null,
      name: agent.name,
    },
    expires_at: grant.expiresAt,
    resources: {
      capability_cards: cards.filter((card) => capabilityIds.has(card.id)).map(cardToWire),
      claims: claims
        .filter((claim) => {
          if (!claimIds.has(claim.id) || claim.revokedAt) return false;
          if (claim.expiresAt && Date.parse(claim.expiresAt) <= now) return false;
          return true;
        })
        .map((claim) => ({
          id: claim.id,
          issuer: claim.issuer,
          subject_mint: claim.subjectMint,
          type: claim.type,
          value: claim.value,
          evidence_url: claim.evidenceUrl,
          signature: claim.signature,
          visibility: claim.visibility,
          expires_at: claim.expiresAt,
          revoked_at: claim.revokedAt,
          created_at: claim.createdAt,
        })),
      receipts: disclosedReceipts,
    },
  };
}

async function resolveMint(
  db: DbClient,
  query: { mint?: string; handle?: string; domain?: string },
) {
  const selectors = [query.mint, query.handle, query.domain].filter(Boolean);
  if (selectors.length !== 1) {
    throw invalidRequest('provide exactly one of: mint, handle, domain');
  }
  if (query.mint) return query.mint;
  if (query.handle) {
    const profile = await getAgentIdentityProfileByHandle(db, normalizeHandle(query.handle));
    if (!profile) throw notFound('handle not found');
    return profile.agentMint;
  }
  const domain = await getAgentIdentityDomain(db, normalizeDomain(query.domain!));
  if (!domain || domain.status !== 'verified') throw notFound('verified domain not found');
  return domain.agentMint;
}

async function verifyDomainWellKnown(args: {
  fetchImpl: typeof globalThis.fetch;
  domain: string;
  mint: string;
  network: SvmNetwork;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await args.fetchImpl(`https://${args.domain}/.well-known/leash-agent.json`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `well-known returned HTTP ${res.status}` };
    const json = (await res.json()) as { mint?: unknown; network?: unknown };
    if (json.mint !== args.mint) return { ok: false, error: 'well-known mint mismatch' };
    if (json.network != null && json.network !== args.network) {
      return { ok: false, error: 'well-known network mismatch' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

function normalizeCards(
  cards: Array<z.infer<typeof CapabilityCardSchema>>,
): IdentityCapabilityCard[] {
  return cards.map((card) => ({
    id: card.id ?? ulid(),
    kind: card.kind,
    title: card.title,
    ...(card.description ? { description: card.description } : {}),
    ...(card.source ? { source: card.source } : {}),
    ...(card.slug ? { slug: card.slug } : {}),
    ...(card.endpoint ? { endpoint: card.endpoint } : {}),
    tags: card.tags,
    protocols: card.protocols,
    visibility: card.visibility,
  }));
}

export function buildAgentIdentityProfileRoutes(deps: AgentIdentityProfileDeps): OpenAPIHono {
  const app = new OpenAPIHono();
  app.use('/v1/platform/*', adminAuth(deps.config.adminSecret));

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/identity/resolve',
      tags: ['identity'],
      summary: 'Resolve an agent identity by mint, handle, or verified domain.',
      request: {
        query: z.object({
          mint: PubkeySchema.optional(),
          handle: z.string().optional(),
          domain: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PublicIdentityProfileSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const mint = await resolveMint(deps.db, c.req.valid('query'));
      return c.json(await publicProfile(deps.db, mint), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/identity/verify',
      tags: ['identity'],
      summary: 'Return an agent-to-agent trust verdict for an identity selector.',
      request: {
        body: {
          required: true,
          content: { 'application/json': { schema: VerificationDecisionRequestSchema } },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: VerificationDecisionResponseSchema } },
        },
      },
    }),
    async (c) => c.json(await verificationDecision(deps.db, c.req.valid('json')), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/identity/verify',
      tags: ['identity'],
      summary: 'Verify that an identity selector resolves to a live agent.',
      request: {
        query: z.object({
          mint: PubkeySchema.optional(),
          handle: z.string().optional(),
          domain: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: VerifyResponseSchema } },
        },
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      try {
        const mint = await resolveMint(deps.db, query);
        const agent = await getPlatformAgent(deps.db, mint);
        return c.json(
          {
            verified: agent != null,
            resolved_mint: agent?.mint ?? null,
            network: agent?.network ?? null,
            checks: [
              {
                name: 'selector_resolves',
                passed: true,
                detail: 'selector resolved to an agent mint',
              },
              {
                name: 'agent_exists',
                passed: agent != null,
                detail: agent ? 'platform agent is active or recorded' : 'agent row not found',
              },
            ],
          },
          200,
        );
      } catch (err) {
        return c.json(
          {
            verified: false,
            resolved_mint: null,
            network: null,
            checks: [
              {
                name: 'selector_resolves',
                passed: false,
                detail: err instanceof Error ? err.message : 'selector did not resolve',
              },
            ],
          },
          200,
        );
      }
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/identity/{mint}',
      tags: ['identity'],
      summary: 'Fetch the public identity profile for an agent mint.',
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PublicIdentityProfileSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => c.json(await publicProfile(deps.db, c.req.valid('param').mint), 200),
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/identity/disclosures/{token}',
      tags: ['identity'],
      summary: 'Read a shareable selective-disclosure grant by bearer token.',
      request: { params: z.object({ token: z.string().min(16) }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: DisclosureReadResponseSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => c.json(await readDisclosure(deps.db, c.req.valid('param').token), 200),
  );

  app.openapi(
    createRoute({
      method: 'put',
      path: '/v1/platform/agents/{mint}/identity',
      tags: ['platform', 'identity'],
      summary: 'Update handle, visibility, and capability cards for an agent identity.',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                handle: z.string().nullable().optional(),
                visibility: z.record(z.unknown()).optional(),
                capability_cards: z.array(CapabilityCardSchema).optional(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PublicIdentityProfileSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
        409: {
          description: 'conflict',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      try {
        await upsertAgentIdentityProfile(deps.db, {
          agentMint: mint,
          network: agent.network,
          ...(body.handle !== undefined
            ? { handle: body.handle == null ? null : normalizeHandle(body.handle) }
            : {}),
          ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
          ...(body.capability_cards !== undefined
            ? { capabilityCards: normalizeCards(body.capability_cards) }
            : {}),
        });
      } catch (err) {
        if ((err as Error).message.toLowerCase().includes('unique')) {
          throw conflict('handle is already claimed');
        }
        throw err;
      }
      return c.json(await adminProfile(deps.db, mint), 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/agents/{mint}/identity',
      tags: ['platform', 'identity'],
      summary: 'Fetch the editable identity profile for an agent.',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: PublicIdentityProfileSchema } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => c.json(await adminProfile(deps.db, c.req.valid('param').mint), 200),
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/agents/{mint}/identity/domains/verify',
      tags: ['platform', 'identity'],
      summary: 'Verify a domain by reading /.well-known/leash-agent.json.',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: { 'application/json': { schema: z.object({ domain: z.string().min(1) }) } },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({ domain: z.string(), status: z.literal('verified') }),
            },
          },
        },
        422: {
          description: 'invalid',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const { domain: rawDomain } = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      const domain = normalizeDomain(rawDomain);
      const result = await verifyDomainWellKnown({
        fetchImpl: deps.fetchImpl ?? globalThis.fetch,
        domain,
        mint,
        network: agent.network,
      });
      if (!result.ok) {
        await upsertAgentIdentityDomain(deps.db, {
          domain,
          agentMint: mint,
          network: agent.network,
          status: 'failed',
          lastError: result.error,
        });
        throw invalidRequest(result.error);
      }
      await upsertAgentIdentityDomain(deps.db, {
        domain,
        agentMint: mint,
        network: agent.network,
        status: 'verified',
        verifiedAt: new Date().toISOString(),
        lastError: null,
      });
      return c.json({ domain, status: 'verified' as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/agents/{mint}/identity/claims',
      tags: ['platform', 'identity'],
      summary: 'Attach a signed claim to an agent identity.',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                issuer: z.string().min(1).max(200),
                subject_mint: PubkeySchema.optional(),
                type: z.string().min(1).max(120),
                value: z.string().min(1).max(2000),
                evidence_url: z.string().url().max(800).optional().nullable(),
                signature: z.string().min(16).max(5000),
                visibility: z.enum(['public', 'private']).default('public'),
                expires_at: z.string().optional().nullable(),
              }),
            },
          },
        },
      },
      responses: {
        200: { description: 'ok', content: { 'application/json': { schema: ClaimSchema } } },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      const claim = await createAgentIdentityClaim(deps.db, {
        agentMint: mint,
        network: agent.network,
        issuer: body.issuer,
        subjectMint: body.subject_mint ?? mint,
        type: body.type,
        value: body.value,
        evidenceUrl: body.evidence_url ?? null,
        signature: body.signature,
        visibility: body.visibility,
        expiresAt: body.expires_at ?? null,
      });
      return c.json(
        {
          id: claim.id,
          issuer: claim.issuer,
          subject_mint: claim.subjectMint,
          type: claim.type,
          value: claim.value,
          evidence_url: claim.evidenceUrl,
          signature: claim.signature,
          visibility: claim.visibility,
          expires_at: claim.expiresAt,
          revoked_at: claim.revokedAt,
          created_at: claim.createdAt,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/platform/agents/{mint}/identity/claims/{id}',
      tags: ['platform', 'identity'],
      summary: 'Revoke a claim attached to an agent identity.',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ mint: PubkeySchema, id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint, id } = c.req.valid('param');
      const claim = await getAgentIdentityClaim(deps.db, id);
      if (!claim || claim.agentMint !== mint) throw notFound('claim not found');
      await revokeAgentIdentityClaim(deps.db, id);
      return c.json({ ok: true as const }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/v1/platform/agents/{mint}/identity/disclosures',
      tags: ['platform', 'identity'],
      summary: 'List selective-disclosure grants for an agent identity.',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ mint: PubkeySchema }) },
      responses: {
        200: {
          description: 'ok',
          content: {
            'application/json': {
              schema: z.object({ items: z.array(DisclosureGrantSchema) }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      const items = await listIdentityDisclosures(deps.db, mint);
      return c.json({ items: items.map(grantToWire) }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'post',
      path: '/v1/platform/agents/{mint}/identity/disclosures',
      tags: ['platform', 'identity'],
      summary: 'Create a shareable selective-disclosure grant.',
      security: [{ AdminSecret: [] }],
      request: {
        params: z.object({ mint: PubkeySchema }),
        body: {
          required: true,
          content: {
            'application/json': {
              schema: z.object({
                resources: z.array(DisclosureResourceSchema).min(1).max(50),
                expires_at: z.string().optional().nullable(),
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: CreateDisclosureResponseSchema } },
        },
      },
    }),
    async (c) => {
      const { mint } = c.req.valid('param');
      const body = c.req.valid('json');
      const agent = await getPlatformAgent(deps.db, mint);
      if (!agent) throw notFound('agent not found');
      const token = newDisclosureToken();
      const grant = await createIdentityDisclosure(deps.db, {
        agentMint: mint,
        network: agent.network,
        tokenHash: hashDisclosureToken(token),
        resources: body.resources,
        expiresAt: disclosureExpiry(body.expires_at),
      });
      return c.json(
        {
          ...grantToWire(grant),
          token,
          url: `${deps.config.publicOrigin.replace(/\/+$/, '')}/v1/identity/disclosures/${token}`,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/v1/platform/agents/{mint}/identity/disclosures/{id}',
      tags: ['platform', 'identity'],
      summary: 'Revoke a selective-disclosure grant.',
      security: [{ AdminSecret: [] }],
      request: { params: z.object({ mint: PubkeySchema, id: z.string().min(1) }) },
      responses: {
        200: {
          description: 'ok',
          content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } },
        },
        404: {
          description: 'not found',
          content: { 'application/json': { schema: ApiErrorSchema } },
        },
      },
    }),
    async (c) => {
      const { mint, id } = c.req.valid('param');
      const grant = await getIdentityDisclosure(deps.db, id);
      if (!grant || grant.agentMint !== mint) throw notFound('disclosure not found');
      await revokeIdentityDisclosure(deps.db, id);
      return c.json({ ok: true as const }, 200);
    },
  );

  return app;
}
