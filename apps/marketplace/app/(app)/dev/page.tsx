'use client';

import Link from 'next/link';
import { usePrivy } from '@privy-io/react-auth';

export default function DevOverviewPage() {
  const { user } = usePrivy();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome, dev.</h1>
        <p className="text-fg-muted text-sm mt-1">
          Signed in as{' '}
          <code className="text-fg">{user?.email?.address ?? user?.wallet?.address}</code>.
        </p>
      </div>
      <ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          href="/settings/api-keys"
          title="Get an API key"
          body="`lsh_*` keys with marketplace scope. Required to list and manage tools."
        />
        <Card
          href="/dev/list"
          title="List a tool"
          body="Paste your `leash-mcp.json` URL and we'll draft the listing. You confirm, we publish."
        />
        <Card
          href="/dev/listings"
          title="Manage listings"
          body="Edit pricing, see receipts and ratings, toggle availability."
        />
      </ul>
    </div>
  );
}

function Card({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <li>
      <Link
        href={href}
        className="block rounded-lg border bg-bg-elev p-5 hover:border-border-strong transition-colors"
      >
        <h3 className="font-medium">{title}</h3>
        <p className="text-sm text-fg-muted mt-1">{body}</p>
      </Link>
    </li>
  );
}
