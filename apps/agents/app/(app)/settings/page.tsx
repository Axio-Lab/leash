import Link from 'next/link';
import { KeyRound, Plug, Settings2, Sparkles, Star, Wallet, type LucideIcon } from 'lucide-react';

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
    title: 'Skills',
    desc: 'Custom system-prompt fragments + optional tool allow-list',
    href: '/settings/skills',
    Icon: Sparkles,
  },
  {
    title: 'Spend',
    desc: 'Treasury caps and delegation controls for your agent',
    href: '/settings/spend',
    Icon: Wallet,
  },
  {
    title: 'LLM keys',
    desc: 'Optional BYOK Anthropic key — defaults to platform Claude',
    href: '/settings/llm',
    Icon: Settings2,
  },
  {
    title: 'API keys',
    desc: 'Programmatic lsh_* keys for integrations',
    href: '/settings/api-keys',
    Icon: KeyRound,
  },
];

export default function SettingsOverviewPage() {
  return (
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
  );
}
