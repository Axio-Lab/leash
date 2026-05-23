'use client';

export type PayableEndpoint = {
  method: 'GET' | 'POST';
  url: string;
  description: string;
};

export function ToolsTable({ endpoints }: { endpoints: PayableEndpoint[] }) {
  if (endpoints.length === 0) {
    return (
      <p className="text-fg-muted text-sm">
        This listing has not published individual payable endpoints yet.
      </p>
    );
  }
  return (
    <ul className="divide-y">
      {endpoints.map((endpoint, index) => (
        <li key={`${endpoint.method}-${endpoint.url}-${index}`} className="py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded border bg-bg px-2 py-1 font-mono text-[11px] text-brand">
              {endpoint.method}
            </code>
            <code className="min-w-0 break-all font-mono text-xs text-fg-muted">
              {endpoint.url}
            </code>
          </div>
          <p className="mt-2 text-fg-muted">{endpoint.description}</p>
        </li>
      ))}
    </ul>
  );
}
