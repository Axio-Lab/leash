import { z } from 'zod';
import { LeashBlockV1Schema } from './leash-block.js';

const ServiceSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  version: z.string().optional(),
  skills: z.array(z.unknown()).optional(),
  domains: z.array(z.string()).optional(),
});

const RegistrationEntrySchema = z.object({
  agentId: z.string(),
  agentRegistry: z.string(),
});

export const RegistrationV1Schema = z.object({
  type: z.literal('https://eips.ethereum.org/EIPS/eip-8004#registration-v1'),
  name: z.string(),
  description: z.string(),
  image: z.string(),
  services: z.array(ServiceSchema).optional(),
  active: z.boolean().optional(),
  registrations: z.array(RegistrationEntrySchema).optional(),
  supportedTrust: z.array(z.string()).optional(),
  leash: LeashBlockV1Schema.optional(),
});

export type RegistrationV1 = z.infer<typeof RegistrationV1Schema>;
