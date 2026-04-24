import { cn } from '@/lib/cn';

export function Empty({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[--color-border] bg-[--color-bg-elev] px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-sm font-medium text-[--color-fg]">{title}</p>
      {description ? <p className="text-xs text-[--color-fg-muted]">{description}</p> : null}
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
      title="Cannot reach the Leash database"
      description={`(${network}) ${message}. Check LEASH_DB_URL on the explorer process.`}
    />
  );
}

/**
 * Rendered when a Solana RPC read fails on the agent page.
 */
export function RpcUnreachable({ network, message }: { network: string; message: string }) {
  return (
    <Empty
      title="Cannot reach the Solana RPC"
      description={`(${network}) ${message}. Check LEASH_RPC_${network.toUpperCase()}.`}
    />
  );
}
