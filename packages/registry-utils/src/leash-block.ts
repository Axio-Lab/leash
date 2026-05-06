import { LeashBlockV1Schema, type LeashBlockV1 } from '@leashmarket/schemas';

export function parseLeashBlock(input: unknown): LeashBlockV1 {
  return LeashBlockV1Schema.parse(input);
}
