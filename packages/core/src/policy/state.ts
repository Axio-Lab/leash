import type { RulesV1 } from '@leashmarket/schemas';

export type PolicyState = {
  rules: RulesV1;
  /** Total spent today in minor units or decimal string — v0.1 uses string decimal for simplicity. */
  spentToday: string;
  recentRequestHashes: string[];
};
