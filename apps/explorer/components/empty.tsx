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

export function ApiUnreachable({ network, message }: { network: string; message: string }) {
  return (
    <Empty
      title="Cannot reach the Leash API"
      description={`(${network}) ${message}. Check LEASH_API_URL and LEASH_EXPLORER_API_KEY_${network.toUpperCase()}.`}
    />
  );
}
