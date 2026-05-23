import { CreatorShell } from '@/components/creator-shell';

/**
 * Creator dashboard chrome. Owns the sidebar, top bar, and auth gate.
 * Every authenticated route lives under `/creator/*`:
 *   /creator                    — overview + animated MCP simulator
 *   /creator/tools              — your listings
 *   /creator/list               — create payment links + list a new tool
 *   /creator/api-keys           — keys
 *   /creator/docs               — onboarding doc
 *   /creator/admin/queue        — moderation queue (admin allowlist)
 */
export default function CreatorLayout({ children }: { children: React.ReactNode }) {
  return <CreatorShell>{children}</CreatorShell>;
}
