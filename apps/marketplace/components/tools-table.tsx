'use client';

export type Tool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown> | null;
};

export function ToolsTable({ tools }: { tools: Tool[] }) {
  if (tools.length === 0) {
    return <p className="text-fg-muted text-sm">No tools listed.</p>;
  }
  return (
    <ul className="divide-y">
      {tools.map((t) => (
        <li key={t.name} className="py-3 flex items-start gap-3 text-sm">
          <code className="font-mono text-brand min-w-[10ch]">{t.name}</code>
          <span className="text-fg-muted">{t.description}</span>
        </li>
      ))}
    </ul>
  );
}
