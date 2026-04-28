'use client';

import * as React from 'react';
import { useSWRConfig } from 'swr';

import { ApiKeysTable } from '@/components/api-keys-table';
import { CreateKeyDialog, type CreatedKey } from '@/components/create-key-dialog';
import { ShowKeyOnceModal } from '@/components/show-key-once';

export default function ApiKeysPage() {
  const [open, setOpen] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedKey | null>(null);
  const { mutate } = useSWRConfig();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Use these to manage your marketplace listings programmatically. The plaintext value is
          shown once after creation.
        </p>
      </div>
      <ApiKeysTable onCreate={() => setOpen(true)} />
      <CreateKeyDialog
        open={open}
        onClose={() => setOpen(false)}
        defaultScopes={['marketplace']}
        onCreated={(k) => {
          setOpen(false);
          setCreated(k);
          mutate('/api/keys');
        }}
      />
      <ShowKeyOnceModal plaintext={created?.plaintext ?? null} onClose={() => setCreated(null)} />
    </div>
  );
}
