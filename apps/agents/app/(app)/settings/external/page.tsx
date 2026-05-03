'use client';

import * as React from 'react';
import { useSWRConfig } from 'swr';

import { ExternalConnectionsTable } from '@/components/external-connections-table';
import { AddTelegramModal } from '@/components/external-add-telegram-modal';
import { AddWhatsAppModal } from '@/components/external-add-whatsapp-modal';

export default function ExternalSettingsPage() {
  const [tgOpen, setTgOpen] = React.useState(false);
  const [waOpen, setWaOpen] = React.useState(false);
  const { mutate } = useSWRConfig();

  const refresh = React.useCallback(() => {
    void mutate('/api/external/connections');
  }, [mutate]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">External chat</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Connect Telegram or WhatsApp so your agent reaches you where you already chat — same
          tools, channel-native formatting.
        </p>
      </div>

      <div className="space-y-1.5 rounded-md border border-border bg-bg-elev/50 px-3.5 py-3 text-xs text-fg-muted">
        <div className="font-medium text-fg">Two safety modes</div>
        <ul className="ml-3 list-disc space-y-0.5 leading-relaxed">
          <li>
            <strong className="text-fg">Deep-link confirm</strong> (default): the bot replies with a
            one-time link you open in this browser; you sign with your Privy wallet here. The server
            never holds keys.
          </li>
          <li>
            <strong className="text-fg">Delegated</strong>: the server signs inline in the chat,
            capped per-tx and per-day. Faster but introduces a bounded delegate. Withdrawals always
            deep-link, regardless of mode.
          </li>
        </ul>
      </div>

      <ExternalConnectionsTable
        onAddTelegram={() => setTgOpen(true)}
        onAddWhatsApp={() => setWaOpen(true)}
      />

      <AddTelegramModal open={tgOpen} onClose={() => setTgOpen(false)} onPaired={refresh} />
      <AddWhatsAppModal open={waOpen} onClose={() => setWaOpen(false)} onPaired={refresh} />
    </div>
  );
}
