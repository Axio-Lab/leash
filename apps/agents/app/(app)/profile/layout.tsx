import { ProfileNav } from '@/components/profile-nav';

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        <header className="space-y-1">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="text-xs sm:text-sm text-fg-muted">
            Your identity, your on-chain agent, and the credentials that make it run.
          </p>
        </header>
        <ProfileNav />
        <div className="pt-1">{children}</div>
      </div>
    </div>
  );
}
