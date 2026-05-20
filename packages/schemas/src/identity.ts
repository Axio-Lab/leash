import { z } from 'zod';

export const IdentityNetworkSchema = z.enum(['solana-devnet', 'solana-mainnet']);
export type SvmNetwork = z.infer<typeof IdentityNetworkSchema>;

export const IdentityVisibilitySchema = z.enum(['public', 'private']);
export type IdentityVisibility = z.infer<typeof IdentityVisibilitySchema>;

export const IdentitySelectorSchema = z.object({
  mint: z.string().min(1).optional(),
  handle: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
});
export type IdentitySelector = z.infer<typeof IdentitySelectorSchema>;

export const IdentityCapabilityKindSchema = z.enum([
  'seller_api',
  'buyer_tool',
  'data_source',
  'control_channel',
  'automation',
  'marketplace',
  'pay_skills',
  'custom',
]);
export type IdentityCapabilityKind = z.infer<typeof IdentityCapabilityKindSchema>;

export const IdentityCapabilitySourceSchema = z.enum([
  'leash',
  'pay-skills',
  'manual',
  'connection',
  'automation',
]);
export type IdentityCapabilitySource = z.infer<typeof IdentityCapabilitySourceSchema>;

export const IdentityCapabilityProtocolSchema = z.enum(['x402', 'mpp']);
export type IdentityCapabilityProtocol = z.infer<typeof IdentityCapabilityProtocolSchema>;

export const IdentityCapabilityCardInputSchema = z.object({
  id: z.string().min(1).optional(),
  kind: IdentityCapabilityKindSchema,
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  source: IdentityCapabilitySourceSchema.optional(),
  slug: z.string().max(200).optional(),
  endpoint: z.string().url().max(800).optional(),
  tags: z.array(z.string().min(1).max(40)).default([]),
  protocols: z.array(IdentityCapabilityProtocolSchema).default([]),
  visibility: IdentityVisibilitySchema.default('public'),
});
export type IdentityCapabilityCardInput = z.input<typeof IdentityCapabilityCardInputSchema>;

export const IdentityCapabilityCardSchema = IdentityCapabilityCardInputSchema.extend({
  id: z.string().min(1),
});
export type IdentityCapabilityCard = z.infer<typeof IdentityCapabilityCardSchema>;

export const IdentityClaimSchema = z.object({
  id: z.string(),
  issuer: z.string(),
  subject_mint: z.string(),
  type: z.string(),
  value: z.string(),
  evidence_url: z.string().nullable(),
  signature: z.string(),
  visibility: IdentityVisibilitySchema,
  expires_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
export type IdentityClaim = z.infer<typeof IdentityClaimSchema>;

export const OperatorHistoryKindSchema = z.enum([
  'executive_register',
  'executive_delegate',
  'delegation_set',
  'delegation_revoke',
]);
export type OperatorHistoryKind = z.infer<typeof OperatorHistoryKindSchema>;

export const OperatorHistoryPhaseSchema = z.enum(['prepared', 'submitted', 'confirmed', 'failed']);
export type OperatorHistoryPhase = z.infer<typeof OperatorHistoryPhaseSchema>;

export const OperatorHistoryEntrySchema = z.object({
  event_id: z.string(),
  kind: OperatorHistoryKindSchema,
  phase: OperatorHistoryPhaseSchema,
  actor: z.string().nullable(),
  delegate: z.string().nullable(),
  executive: z.string().nullable(),
  token_mint: z.string().nullable(),
  source_token_account: z.string().nullable(),
  delegated_amount: z.string().nullable(),
  signature: z.string().nullable(),
  event_source: z.string(),
  created_at: z.string(),
  confirmed_at: z.string().nullable(),
  failed_at: z.string().nullable(),
});
export type OperatorHistoryEntry = z.infer<typeof OperatorHistoryEntrySchema>;

export const IdentityReputationSummarySchema = z.object({
  settled_calls: z.number().int(),
  denied_calls: z.number().int(),
  rating: z.number(),
});
export type IdentityReputationSummary = z.infer<typeof IdentityReputationSummarySchema>;

export const PublicIdentityProfileSchema = z.object({
  mint: z.string(),
  network: IdentityNetworkSchema,
  handle: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  image_url: z.string().nullable(),
  treasury: z.string(),
  services: z.array(z.object({ name: z.string(), endpoint: z.string() })),
  verified_domains: z.array(z.string()),
  capability_cards: z.array(IdentityCapabilityCardSchema),
  claims: z.array(IdentityClaimSchema),
  operator_history: z.array(OperatorHistoryEntrySchema),
  reputation: IdentityReputationSummarySchema,
});
export type PublicIdentityProfile = z.infer<typeof PublicIdentityProfileSchema>;

export const IdentityVerifyResponseSchema = z.object({
  verified: z.boolean(),
  resolved_mint: z.string().nullable(),
  network: IdentityNetworkSchema.nullable(),
  checks: z.array(z.object({ name: z.string(), passed: z.boolean(), detail: z.string() })),
});
export type IdentityVerifyResponse = z.infer<typeof IdentityVerifyResponseSchema>;

export const IdentityVerificationIntentSchema = z.enum([
  'pay',
  'call_capability',
  'trust_claim',
  'inspect',
]);
export type IdentityVerificationIntent = z.infer<typeof IdentityVerificationIntentSchema>;

export const IdentityCapabilityRequirementSchema = z.object({
  kind: z.string().optional(),
  slug: z.string().optional(),
  endpoint: z.string().optional(),
  protocol: IdentityCapabilityProtocolSchema.optional(),
});
export type IdentityCapabilityRequirement = z.infer<typeof IdentityCapabilityRequirementSchema>;

export const IdentityVerificationThresholdsSchema = z.object({
  min_rating: z.number().min(0).max(1).optional(),
  required_claim_types: z.array(z.string().min(1)).optional(),
  require_verified_domain: z.boolean().optional(),
});
export type IdentityVerificationThresholds = z.infer<typeof IdentityVerificationThresholdsSchema>;

export const IdentityVerificationDecisionRequestSchema = z.object({
  selector: IdentitySelectorSchema.optional(),
  mint: z.string().optional(),
  handle: z.string().optional(),
  domain: z.string().optional(),
  intent: IdentityVerificationIntentSchema.optional(),
  capability: IdentityCapabilityRequirementSchema.optional(),
  thresholds: IdentityVerificationThresholdsSchema.optional(),
});
export type IdentityVerificationDecisionRequest = z.infer<
  typeof IdentityVerificationDecisionRequestSchema
>;

export const IdentityVerificationCheckSchema = z.object({
  name: z.string(),
  passed: z.boolean(),
  severity: z.enum(['info', 'warn', 'deny']),
  detail: z.string(),
});
export type IdentityVerificationCheck = z.infer<typeof IdentityVerificationCheckSchema>;

export const IdentityVerificationDecisionProfileSchema = z
  .object({
    mint: z.string(),
    handle: z.string().nullable(),
    name: z.string(),
    verified_domains: z.array(z.string()),
    reputation: IdentityReputationSummarySchema,
    capability_cards_count: z.number().int(),
    claims_count: z.number().int(),
  })
  .nullable();
export type IdentityVerificationDecisionProfile = z.infer<
  typeof IdentityVerificationDecisionProfileSchema
>;

export const IdentityVerificationDecisionSchema = z.object({
  verdict: z.enum(['allow', 'warn', 'deny']),
  resolved_mint: z.string().nullable(),
  network: IdentityNetworkSchema.nullable(),
  score: z.number(),
  checks: z.array(IdentityVerificationCheckSchema),
  profile: IdentityVerificationDecisionProfileSchema,
});
export type IdentityVerificationDecision = z.infer<typeof IdentityVerificationDecisionSchema>;

export const IdentityDisclosureResourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('capability_card'), id: z.string().min(1) }),
  z.object({ kind: z.literal('claim'), id: z.string().min(1) }),
  z.object({
    kind: z.literal('receipt'),
    receipt_hash: z.string().min(16).max(128),
    fields: z.array(z.enum(['summary', 'request', 'price', 'response', 'tx'])).optional(),
  }),
]);
export type IdentityDisclosureResource = z.infer<typeof IdentityDisclosureResourceSchema>;

export const IdentityDisclosureGrantSchema = z.object({
  id: z.string(),
  agent_mint: z.string(),
  network: IdentityNetworkSchema,
  resources: z.array(IdentityDisclosureResourceSchema),
  expires_at: z.string(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
export type IdentityDisclosureGrant = z.infer<typeof IdentityDisclosureGrantSchema>;

export const IdentityDisclosureCreateResponseSchema = IdentityDisclosureGrantSchema.extend({
  token: z.string(),
  url: z.string(),
});
export type IdentityDisclosureCreateResponse = z.infer<
  typeof IdentityDisclosureCreateResponseSchema
>;

export const IdentityDisclosureReadSchema = z.object({
  id: z.string(),
  agent: z.object({
    mint: z.string(),
    network: IdentityNetworkSchema,
    handle: z.string().nullable(),
    name: z.string(),
  }),
  expires_at: z.string(),
  resources: z.object({
    capability_cards: z.array(IdentityCapabilityCardSchema),
    claims: z.array(IdentityClaimSchema),
    receipts: z.array(z.record(z.unknown())),
  }),
});
export type IdentityDisclosureRead = z.infer<typeof IdentityDisclosureReadSchema>;

export const SellerIdentityMetadataSchema = z.object({
  agent_mint: z.string(),
  handle: z.string().optional(),
  domain: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  capability_cards: z.array(IdentityCapabilityRequirementSchema).optional(),
  claims: z.array(z.string()).optional(),
});
export type SellerIdentityMetadata = z.infer<typeof SellerIdentityMetadataSchema>;

export const SellerIdentityMetadataEnvelopeSchema = z.object({
  leash: z.object({
    identity: SellerIdentityMetadataSchema.extend({ v: z.literal('0.1') }),
  }),
});
export type SellerIdentityMetadataEnvelope = z.infer<typeof SellerIdentityMetadataEnvelopeSchema>;
