import { z } from 'zod';

const uriOrIpfs = z.union([
  z.string().url(),
  z.string().regex(/^ipfs:\/\/.+/i, 'Expected ipfs:// CID URI'),
]);

export const LeashBlockV1Schema = z.object({
  v: z.literal('0.1'),
  rulesUri: uriOrIpfs,
  receiptsFeed: z
    .string()
    .refine(
      (s) => s.startsWith('http://') || s.startsWith('https://'),
      'Expected http(s) receipts feed URL',
    ),
  anchor: z
    .object({
      program: z.string(),
      merkleAccount: z.string(),
    })
    .optional(),
  killSwitch: z
    .object({
      onchain: z.string().optional(),
      endpoint: z.string().url().optional(),
    })
    .optional(),
});

export type LeashBlockV1 = z.infer<typeof LeashBlockV1Schema>;
