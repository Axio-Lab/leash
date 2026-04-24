/**
 * Common request/response Zod fragments used by multiple route modules.
 * Centralised so the OpenAPI doc has consistent schema names.
 */

import { z } from '@hono/zod-openapi';

export const PubkeySchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'expected base58 pubkey')
  .openapi({ example: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' });

export const TokenProgramFlavorSchema = z.enum(['spl', 'token-2022']).openapi({
  description: 'Which SPL token program owns the mint. Defaults to classic SPL.',
});

export const NetworkSchema = z
  .enum(['solana-devnet', 'solana-mainnet'])
  .openapi({ description: 'Network slug. Always equals the API key prefix.' });

export const PreparedTransactionSchema = z
  .object({
    base64: z.string(),
    message_base64: z.string(),
    recent_blockhash: z.string(),
    last_valid_block_height: z.number().int().optional(),
    fee_payer: PubkeySchema,
    signers: z.array(PubkeySchema),
  })
  .openapi('PreparedTransaction');

export const SignerOptionsSchema = z.object({
  payer: PubkeySchema.openapi({ description: 'Public key of the rent + fee payer.' }),
  authority: PubkeySchema.optional().openapi({
    description: 'Asset owner / authority signer. Defaults to `payer`.',
  }),
  client_reference: z
    .string()
    .max(256)
    .optional()
    .openapi({ description: 'Free-form caller reference echoed onto the event row.' }),
});

export const PreparedEnvelopeOpenApi = (echoSchema: z.ZodTypeAny) =>
  z.object({
    event_id: z.string(),
    network: NetworkSchema,
    transaction: PreparedTransactionSchema,
    echo: echoSchema,
  });

export const PreparedNoOpEnvelopeOpenApi = (echoSchema: z.ZodTypeAny) =>
  z.object({
    event_id: z.null(),
    network: NetworkSchema,
    transaction: z.null(),
    echo: echoSchema,
    no_op: z.literal(true),
  });

export const ApiErrorSchema = z
  .object({
    error: z.string(),
    message: z.string(),
    detail: z.unknown().optional(),
  })
  .openapi('ApiError');
