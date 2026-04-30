'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Streaming-safe markdown renderer for assistant messages.
 *
 * - GFM (tables, autolinks, strikethrough, task lists)
 * - External links open in a new tab and short-circuit to the brand colour
 * - `pre` and inline `code` get the standard "console" treatment
 * - All Tailwind classes assume our existing dark theme
 */
export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div
      className={['prose-leash text-sm leading-relaxed [overflow-wrap:anywhere]', 'space-y-2'].join(
        ' ',
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => (
            <a
              {...rest}
              href={href}
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noreferrer noopener' : undefined}
              className="text-brand underline-offset-2 hover:underline break-all"
            >
              {children}
            </a>
          ),
          p: ({ children }) => <p className="m-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="list-disc pl-5 marker:text-fg-muted space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 marker:text-fg-muted space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
          em: ({ children }) => <em className="italic text-fg">{children}</em>,
          h1: ({ children }) => (
            <h1 className="text-base font-semibold text-fg mt-2">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold text-fg mt-2">{children}</h2>
          ),
          h3: ({ children }) => <h3 className="text-sm font-semibold text-fg mt-2">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-fg-muted italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-border/60" />,
          code: ({ className, children, ...rest }) => {
            const isBlock = /language-/.test(className ?? '');
            if (isBlock) {
              return (
                <code
                  {...rest}
                  className="block whitespace-pre-wrap break-all rounded-md bg-bg/70 border border-border px-3 py-2 text-xs font-mono"
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                {...rest}
                className="rounded bg-bg/70 border border-border px-1.5 py-0.5 text-[0.85em] font-mono"
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="overflow-x-auto scrollbar-thin">{children}</pre>,
          table: ({ children }) => (
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border text-left font-medium text-fg-muted px-2 py-1">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/60 px-2 py-1 align-top">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
