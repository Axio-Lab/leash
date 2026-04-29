'use client';

import * as React from 'react';
import { KeyRound } from 'lucide-react';
import { useSWRConfig } from 'swr';

import { ApiKeysTable } from '@/components/api-keys-table';
import { CreateKeyDialog, type CreatedKey } from '@/components/create-key-dialog';
import { ShowKeyOnceModal } from '@/components/show-key-once';
import { Badge } from '@/components/ui/badge';

export default function ApiKeysPage() {
  const [open, setOpen] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedKey | null>(null);
  const { mutate } = useSWRConfig();
  return (
    <div className="space-y-6 max-w-[1100px]">
      <div>
        <Badge variant="outline" className="font-mono uppercase tracking-widest">
          <KeyRound className="size-3 mr-1.5" /> Auth
        </Badge>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">API keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-fg-muted">
          <code className="font-mono text-fg">lsh_*</code> keys with{' '}
          <code className="font-mono text-fg">marketplace</code> scope let you manage your listings
          programmatically. The plaintext value is shown once after creation — store it in your
          secret manager.
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
