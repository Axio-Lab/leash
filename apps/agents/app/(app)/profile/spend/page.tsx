import { WalletIcon } from 'lucide-react';

export default function ProfileSpendPage() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-bg-elev/60 p-5">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-strong">
            <WalletIcon className="size-4.5" />
          </span>
          <div className="space-y-2 text-sm text-fg-muted max-w-prose">
            <h2 className="text-fg font-medium text-base">Spend controls</h2>
            <p>
              Caps are configured during agent onboarding (per-action / per-task / per-day) and
              enforced by the facilitator on every payment. A dedicated editor surfaces here once
              treasury management is fully wired into the chat-first flow.
            </p>
            <p className="text-xs text-fg-subtle">
              Tip — the active caps are visible from your{' '}
              <code className="font-mono text-[11px]">/profile/agent</code> overview.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
