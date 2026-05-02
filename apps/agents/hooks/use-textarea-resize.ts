'use client';

import * as React from 'react';

/**
 * Auto-grow a textarea to fit its contents up to its CSS `max-height`.
 * Resets to `0` first so shrinking also works when the user deletes lines.
 */
export function useTextareaResize(value: React.ComponentProps<'textarea'>['value'], rows = 1) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    const cs = window.getComputedStyle(ta);
    const lineHeight = Number.parseInt(cs.lineHeight, 10) || 20;
    const padding = Number.parseInt(cs.paddingTop, 10) + Number.parseInt(cs.paddingBottom, 10);
    const minHeight = lineHeight * rows + padding;

    ta.style.height = '0px';
    const next = Math.max(ta.scrollHeight, minHeight);
    ta.style.height = `${next + 2}px`;
  }, [value, rows]);

  return ref;
}
