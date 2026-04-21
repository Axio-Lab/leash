import { z } from 'zod';

const BudgetSchema = z.object({
  daily: z.string(),
  perCall: z.string(),
  currency: z.literal('USDC'),
});

const HostsSchema = z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
});

const CronTriggerSchema = z.object({
  type: z.literal('cron'),
  expression: z.string(),
});

const WebhookTriggerSchema = z.object({
  type: z.literal('webhook'),
  path: z.string(),
});

const IntervalTriggerSchema = z.object({
  type: z.literal('interval'),
  seconds: z.number().int().positive(),
});

const TriggerSchema = z.discriminatedUnion('type', [
  CronTriggerSchema,
  WebhookTriggerSchema,
  IntervalTriggerSchema,
]);

const StopConditionSchema = z.object({
  reason: z.string(),
  when: z.enum(['budget_exceeded', 'manual', 'error_streak']),
});

export const RulesV1Schema = z.object({
  v: z.literal('0.1'),
  budget: BudgetSchema,
  hosts: HostsSchema,
  priceCeiling: z.string().optional(),
  triggers: z.array(TriggerSchema),
  stopOn: z.array(StopConditionSchema).optional(),
});

export type RulesV1 = z.infer<typeof RulesV1Schema>;
