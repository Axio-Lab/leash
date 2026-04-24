/**
 * Map raw EventKind strings to Leash-domain labels for the explorer UI.
 */

import type { EventRow } from './types';

export type EventDescriptor = {
  label: string;
  shortLabel: string;
  variant: 'identity' | 'executive' | 'delegation' | 'treasury' | 'token' | 'submit' | 'receipt';
  description: (e: EventRow) => string;
};

const TABLE: Record<string, EventDescriptor> = {
  'agent.identity.register': {
    label: 'Identity registered',
    shortLabel: 'identity',
    variant: 'identity',
    description: (e) =>
      e.agent_asset
        ? `Agent ${shortAddr(e.agent_asset)} registered its on-chain identity.`
        : 'Agent registered its on-chain identity.',
  },
  'agent.executive.register': {
    label: 'Executive registered',
    shortLabel: 'executive',
    variant: 'executive',
    description: () => 'A wallet was bound as an executive on this cluster.',
  },
  'agent.executive.delegate': {
    label: 'Executive delegated',
    shortLabel: 'delegate',
    variant: 'executive',
    description: (e) =>
      e.agent_asset
        ? `Asset owner of ${shortAddr(e.agent_asset)} delegated execution to an executive.`
        : 'Owner delegated execution to an executive.',
  },
  'agent.delegation.set': {
    label: 'Spend allowance set',
    shortLabel: 'allowance',
    variant: 'delegation',
    description: (e) => {
      const sym = (e.metadata?.['stable_symbol'] as string) ?? 'tokens';
      return `Owner approved an executive to spend up to a capped amount in ${sym}.`;
    },
  },
  'agent.delegation.revoke': {
    label: 'Spend allowance revoked',
    shortLabel: 'revoke',
    variant: 'delegation',
    description: () => 'Spend delegation cleared back to zero.',
  },
  'agent.treasury.provision': {
    label: 'Treasury provisioned',
    shortLabel: 'provision',
    variant: 'treasury',
    description: () => 'Stablecoin ATAs created on the treasury PDA.',
  },
  'agent.treasury.withdraw': {
    label: 'Treasury withdrawal',
    shortLabel: 'withdraw',
    variant: 'treasury',
    description: () => 'Owner moved SPL tokens out of the treasury.',
  },
  'agent.treasury.withdraw_sol': {
    label: 'Treasury SOL withdrawal',
    shortLabel: 'withdraw SOL',
    variant: 'treasury',
    description: () => 'Owner moved native SOL out of the treasury.',
  },
  'agent.token.set': {
    label: 'Agent token set',
    shortLabel: 'token',
    variant: 'token',
    description: () => 'Agent identity now points to an SPL token mint.',
  },
  'submit.raw': {
    label: 'Raw submission',
    shortLabel: 'submit',
    variant: 'submit',
    description: () => 'A signed transaction was broadcast through the API.',
  },
  'receipt.published': {
    label: 'Receipt published',
    shortLabel: 'receipt',
    variant: 'receipt',
    description: (e) =>
      e.agent_asset
        ? `Agent ${shortAddr(e.agent_asset)} appended a receipt to its feed.`
        : 'A receipt was appended to an agent feed.',
  },
  'receipt.pulled': {
    label: 'Receipt pulled',
    shortLabel: 'pulled',
    variant: 'receipt',
    description: () => 'Receipt fetched from a registered pull target.',
  },
};

const FALLBACK: EventDescriptor = {
  label: 'Event',
  shortLabel: 'event',
  variant: 'submit',
  description: (e) => `Unknown event kind: ${e.kind}`,
};

export function describeEvent(row: EventRow): EventDescriptor {
  return TABLE[row.kind] ?? FALLBACK;
}

function shortAddr(s: string): string {
  if (s.length <= 9) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
