'use client';

export type PayableEndpoint = {
  method: 'GET' | 'POST';
  url: string;
  description: string;
  expected_request_body?: Record<string, unknown>;
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
          {endpoint.expected_request_body !== undefined ? (
            <div className="mt-2 rounded-md border bg-bg/60 p-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-fg-subtle">
                Expected request body
              </div>
              <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap wrap-break-word font-mono text-[11px] leading-relaxed text-fg-muted">
                {JSON.stringify(endpoint.expected_request_body, null, 2)}
              </pre>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
