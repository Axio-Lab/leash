import { z } from 'zod';

import type { KoraAgentPolicy, KoraToolName } from './types.js';

export type AppConfig = {
  port: number;
  publicBaseUrl: string;
  kora: {
    publicKey: string;
    secretKey: string;
    baseUrl: string;
  };
  leash: {
    apiUrl: string;
    requireLeash: boolean;
    requireSignature: boolean;
    receiptWebhookUrl: string | null;
  };
  defaultAgent: {
    id: string;
    policy: KoraAgentPolicy;
  };
};

const EnvSchema = z.object({
  PORT: z.string().optional(),
  KORA_AGENT_RAIL_PUBLIC_URL: z.string().optional(),
  KORA_PUBLIC_KEY: z.string().optional(),
  KORA_SECRET_KEY: z.string().optional(),
  KORA_BASE_URL: z.string().optional(),
  LEASH_API_URL: z.string().optional(),
  KORA_REQUIRE_LEASH: z.string().optional(),
  KORA_REQUIRE_LEASH_SIGNATURE: z.string().optional(),
  LEASH_RECEIPT_WEBHOOK_URL: z.string().optional(),
  KORA_DEFAULT_AGENT_ID: z.string().optional(),
  KORA_ALLOWED_CURRENCIES: z.string().optional(),
  KORA_MAX_PAYOUT_AMOUNT: z.string().optional(),
  KORA_DAILY_PAYOUT_LIMIT: z.string().optional(),
  KORA_APPROVAL_THRESHOLD: z.string().optional(),
});

const DEFAULT_TOOLS: KoraToolName[] = [
  'kora_get_agent_capabilities',
  'kora_get_balance',
  'kora_list_banks',
  'kora_resolve_bank_account',
  'kora_create_payout',
  'kora_get_payout_status',
  'kora_list_payouts',
  'kora_create_checkout',
  'kora_create_virtual_account',
  'kora_credit_sandbox_virtual_account',
];

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function listFromEnv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  const port = numberFromEnv(parsed.PORT, 4300);
  const publicBaseUrl =
    parsed.KORA_AGENT_RAIL_PUBLIC_URL?.replace(/\/+$/, '') ?? `http://localhost:${port}`;
  const allowedCurrencies = listFromEnv(parsed.KORA_ALLOWED_CURRENCIES, [
    'NGN',
    'KES',
    'GHS',
    'ZAR',
    'XOF',
    'XAF',
    'EGP',
    'USD',
  ]);

  return {
    port,
    publicBaseUrl,
    kora: {
      publicKey: parsed.KORA_PUBLIC_KEY ?? '',
      secretKey: parsed.KORA_SECRET_KEY ?? '',
      baseUrl: (parsed.KORA_BASE_URL ?? 'https://api.korapay.com').replace(/\/+$/, ''),
    },
    leash: {
      apiUrl: (parsed.LEASH_API_URL ?? 'https://api.leash.market').replace(/\/+$/, ''),
      requireLeash: booleanFromEnv(parsed.KORA_REQUIRE_LEASH, true),
      requireSignature: booleanFromEnv(parsed.KORA_REQUIRE_LEASH_SIGNATURE, true),
      receiptWebhookUrl: parsed.LEASH_RECEIPT_WEBHOOK_URL?.trim() || null,
    },
    defaultAgent: {
      id: parsed.KORA_DEFAULT_AGENT_ID ?? 'demo-kora-agent',
      policy: {
        allowedCapabilities: DEFAULT_TOOLS,
        allowedCurrencies,
        requireVerifiedAgent: booleanFromEnv(parsed.KORA_REQUIRE_LEASH, true),
        allowedCallers: { mints: [], handles: [], domains: [] },
        maxPayoutAmount: numberFromEnv(parsed.KORA_MAX_PAYOUT_AMOUNT, 100_000),
        dailyPayoutLimit: numberFromEnv(parsed.KORA_DAILY_PAYOUT_LIMIT, 500_000),
        approvalThreshold: numberFromEnv(parsed.KORA_APPROVAL_THRESHOLD, 50_000),
      },
    },
  };
}
