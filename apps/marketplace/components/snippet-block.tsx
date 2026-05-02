'use client';

import * as React from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LANGUAGES, type SnippetLanguage, type SnippetParams, snippet } from '@/lib/seller-kit';

/**
 * Tabbed seller-kit snippet block. Used on /creator/snippets and at the
 * end of the list-a-tool flow. Switches between Hono / Express /
 * FastAPI / MCP / manifest / curl. Each pane renders the snippet
 * tailored to the supplied params (slug, price, tool name, etc.).
 */
export function SnippetBlock({
  params,
  defaultLanguage = 'hono',
  className,
}: {
  params: SnippetParams;
  defaultLanguage?: SnippetLanguage;
  className?: string;
}) {
  const [language, setLanguage] = React.useState<SnippetLanguage>(defaultLanguage);
  const code = React.useMemo(() => snippet(language, params), [language, params]);
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  return (
    <Tabs
      value={language}
      onValueChange={(v) => setLanguage(v as SnippetLanguage)}
      className={className}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList className="flex-wrap h-auto">
          {LANGUAGES.map((l) => (
            <TabsTrigger key={l.id} value={l.id}>
              {l.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <Button onClick={copy} variant="outline" size="sm">
          {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {LANGUAGES.map((l) => (
        <TabsContent key={l.id} value={l.id} className="mt-3">
          <p className="mb-2 text-[11px] text-fg-subtle">{l.sub}</p>
          <pre className="overflow-x-auto rounded-md border bg-bg p-4 text-[12px] leading-relaxed font-mono text-fg-muted scrollbar-thin">
            <code>{code}</code>
          </pre>
        </TabsContent>
      ))}
    </Tabs>
  );
}
