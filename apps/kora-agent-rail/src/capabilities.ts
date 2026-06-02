import type { KoraAgentCapability, KoraToolName } from './types.js';

export function buildCapabilities(publicBaseUrl: string): KoraAgentCapability[] {
  const base = publicBaseUrl.replace(/\/+$/, '');
  const tool = (
    name: KoraToolName,
    title: string,
    description: string,
    localCurrency: boolean,
    moneyMovement: boolean,
  ): KoraAgentCapability => ({
    name,
    title,
    description,
    endpoint: `${base}/tools/${name}`,
    localCurrency,
    moneyMovement,
  });

  return [
    tool(
      'kora_get_agent_capabilities',
      'Get Kora Agent capabilities',
      'Return the local-currency services this merchant Kora Agent exposes to AI agents.',
      false,
      false,
    ),
    tool(
      'kora_get_balance',
      'Get Kora balances',
      'Read merchant balances across local currencies before attempting money movement.',
      true,
      false,
    ),
    tool(
      'kora_list_banks',
      'List banks',
      'List Kora-supported bank codes for a country such as NG, KE, or ZA.',
      false,
      false,
    ),
    tool(
      'kora_resolve_bank_account',
      'Resolve bank account',
      'Verify recipient bank account details before a local-currency payout.',
      true,
      false,
    ),
    tool(
      'kora_create_payout',
      'Create payout',
      'Send a policy-gated local-currency payout through Kora.',
      true,
      true,
    ),
    tool(
      'kora_get_payout_status',
      'Get payout status',
      'Fetch status for a Kora payout transaction reference.',
      true,
      false,
    ),
    tool(
      'kora_list_payouts',
      'List payouts',
      'List recent Kora payouts for reconciliation and audit.',
      true,
      false,
    ),
    tool(
      'kora_create_checkout',
      'Create checkout',
      'Create a Kora-hosted checkout for local-currency collection.',
      true,
      true,
    ),
    tool(
      'kora_create_virtual_account',
      'Create virtual account',
      'Create a Kora virtual bank account for local-currency collection.',
      true,
      false,
    ),
    tool(
      'kora_credit_sandbox_virtual_account',
      'Credit sandbox virtual account',
      'Simulate a local-currency sandbox payment into a Kora virtual account.',
      true,
      true,
    ),
  ];
}

export const PUBLIC_TOOLS = new Set<KoraToolName>([
  'kora_get_agent_capabilities',
  'kora_list_banks',
]);

export function isPublicTool(tool: KoraToolName): boolean {
  return PUBLIC_TOOLS.has(tool);
}
