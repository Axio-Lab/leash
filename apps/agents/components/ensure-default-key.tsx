'use client';

import * as React from 'react';
import { usePrivy } from '@privy-io/react-auth';

/**
 * Background hook: once a user is signed in, hit `/api/keys` and create a
 * `"default"` key when they have none. Idempotent — relies on the BFF
 * GET to short-circuit if any active key already exists. Soft-fails when
 * `apps/api` is offline so it doesn't block the rest of the surface.
 *
 * Renders nothing.
 */
export function EnsureDefaultKey() {
  const { authenticated, ready, user } = usePrivy();
  const ranRef = React.useRef(false);

  React.useEffect(() => {
    if (!ready || !authenticated || !user?.id) return;
    if (ranRef.current) return;
    ranRef.current = true;

    void (async () => {
      try {
        const res = await fetch('/api/keys', { credentials: 'include' });
        if (!res.ok) return;
        const j = (await res.json().catch(() => ({}))) as {
          items?: Array<{ disabled_at?: string | null; _offline?: boolean }>;
        };
        const items = Array.isArray(j.items) ? j.items : [];
        // If apps/api is unreachable, bail — we'd just create a duplicate
        // when the upstream comes back online.
        if (items.some((k) => k._offline)) return;
        const hasActive = items.some((k) => !k.disabled_at);
        if (hasActive) return;

        await fetch('/api/keys', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'default',
            scopes: ['agents', 'marketplace'],
          }),
        });
      } catch {
        // Soft-fail — the user can always create a key manually.
      }
    })();
  }, [ready, authenticated, user?.id]);

  return null;
}
