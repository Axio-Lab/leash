import { Database, Radio } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Empty({
  title,
  description,
  className,
  icon,
}: {
  title: string;
  description?: string;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[--color-border-strong] bg-[--color-bg-elev]/50 px-6 py-12 text-center backdrop-blur-md',
        className,
      )}
    >
      {icon ? (
        <div className="grid h-10 w-10 place-items-center rounded-full border border-[--color-border] bg-[--color-bg-elev-2]/80 text-[--color-fg-muted]">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-[--color-fg]">{title}</p>
      {description ? (
        <p className="max-w-md text-xs leading-relaxed text-[--color-fg-muted]">{description}</p>
      ) : null}
    </div>
  );
}

/**
 * Rendered when a Turso/libsql read fails. The explorer is co-located
 * with the API in our infra, so the only realistic cause is a
 * misconfigured `LEASH_DB_URL` or a genuinely-down DB — both
 * operator-side problems, not API-key problems.
 */
export function DbUnreachable({ network, message }: { network: string; message: string }) {
  return (
    <Empty
      icon={<Database className="h-4 w-4" />}
      title="Cannot reach the Leash database"
      description={`(${network}) ${message}. Check LEASH_DB_URL on the explorer process.`}
    />
  );
}

/** Rendered when a Solana RPC read fails on the agent page. */
export function RpcUnreachable({ network, message }: { network: string; message: string }) {
  return (
    <Empty
      icon={<Radio className="h-4 w-4" />}
      title="Cannot reach the Solana RPC"
      description={`(${network}) ${message}. Check LEASH_RPC_${network.toUpperCase()}.`}
    />
  );
}
