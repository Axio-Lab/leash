import { z } from 'zod';

const ReceiptKindSchema = z.enum(['spend', 'earn']);

const PriceSchema = z.object({
  amount: z.string(),
  currency: z.string(),
  network: z.string().optional(),
});

const RequestSummarySchema = z.object({
  method: z.string(),
  url: z.string(),
  body_hash: z.string().nullable(),
  headers_hash: z.string().nullable().optional(),
});

const ResponseSummarySchema = z
  .object({
    status: z.number().int(),
    body_hash: z.string().nullable().optional(),
  })
  .nullable();

export const ReceiptV1Schema = z.object({
  v: z.literal('0.1'),
  kind: ReceiptKindSchema.default('spend'),
  agent: z.string(),
  nonce: z.number().int().nonnegative(),
  ts: z.string(),
  policy_v: z.string(),
  request: RequestSummarySchema,
  decision: z.enum(['allow', 'deny']),
  reason: z.string().nullable(),
  price: PriceSchema.nullable(),
  facilitator: z.enum(['payai', 'corbits', 'self', 'local']).nullable(),
  tx_sig: z.string().nullable(),
  response: ResponseSummarySchema,
  prev_receipt_hash: z.string().nullable(),
  receipt_hash: z.string(),
});

export type ReceiptV1 = z.infer<typeof ReceiptV1Schema>;
