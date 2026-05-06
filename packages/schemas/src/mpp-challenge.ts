import { z } from 'zod';

/** MPP-on-Solana payment requirement embedded in a 402 problem+json body. */
export const MppChallengeRequestSchema = z.object({
  recipient: z.string(),
  amount: z.string(),
  currency: z.string(),
  network: z.string(),
  asset: z.string(),
  deadline: z.string().optional(),
});

export type MppChallengeRequest = z.infer<typeof MppChallengeRequestSchema>;

/**
 * Machine Payments Protocol (MPP) HTTP 402 challenge body (Solana crypto rail).
 * Aligns with problem+json + `challengeId` used by pay / mpp.dev style servers.
 */
export const MppChallengeV1Schema = z.object({
  type: z.literal('https://paymentauth.org/problems/payment-required'),
  title: z.string().optional(),
  status: z.literal(402),
  detail: z.string().optional(),
  challengeId: z.string(),
  request: MppChallengeRequestSchema,
  /** Optional server-issued nonce binding the challenge. */
  nonce: z.string().optional(),
});

export type MppChallengeV1 = z.infer<typeof MppChallengeV1Schema>;
