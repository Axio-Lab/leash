import { CreatorShell } from '@/components/creator-shell';

/**
 * Creator dashboard chrome. Owns the sidebar, top bar, and auth gate.
 * Every authenticated route lives under `/creator/*`:
 *   /creator                    — overview
 *   /creator/tools              — your listings
 *   /creator/monetize           — create hosted x402/MPP payable endpoints
 *   /creator/list               — list provider + payable endpoints in discovery
 *   /creator/api-keys           — keys
 *   /creator/admin/queue        — moderation queue (admin allowlist)
 */
export default function CreatorLayout({ children }: { children: React.ReactNode }) {
  return <CreatorShell>{children}</CreatorShell>;
}
