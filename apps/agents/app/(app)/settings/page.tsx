import Link from 'next/link';
import { ArrowRightIcon, KeyRound, Plug, Star, type LucideIcon } from 'lucide-react';

const cards: Array<{ title: string; desc: string; href: string; Icon: LucideIcon }> = [
  {
    title: 'Connections',
    desc: 'OAuth toolkits via Composio (Gmail, GitHub, Slack…)',
    href: '/settings/connections',
    Icon: Plug,
  },
  {
    title: 'Favorites',
    desc: 'Pin marketplace tools your agent can pay-to-call',
    href: '/settings/favorites',
    Icon: Star,
  },
  {
    title: 'API keys',
    desc: 'Programmatic lsh_* keys for integrations and the agent runtime',
    href: '/settings/api-keys',
    Icon: KeyRound,
  },
];

export default function SettingsOverviewPage() {
  return (
    <div className="space-y-5">
      {/* Hint that the agent-related controls live under Profile now */}
      <div className="rounded-xl border border-border/60 bg-bg-elev/40 p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3 text-xs sm:text-sm">
        <span className="text-fg-muted">
          Looking for skills, spend, or LLM keys?{' '}
          <span className="text-fg-subtle">They moved into Profile.</span>
        </span>
        <Link
          href="/profile"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg hover:border-brand/40 hover:bg-bg-elev"
        >
          Go to Profile
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>

      <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 hover:border-brand/40 hover:bg-bg-elev transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-strong group-hover:bg-brand/25 transition-colors">
                <c.Icon className="size-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{c.title}</div>
                <p className="text-xs sm:text-sm text-fg-muted mt-1 leading-snug">{c.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
