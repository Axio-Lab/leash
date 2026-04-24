/**
 * Tiny formatters used across columns and detail views.
 */

export function shortAddr(value: string | null | undefined, head = 4, tail = 4): string {
  if (!value) return '—';
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatTs(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return value;
  }
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    const ms = Date.now() - d.getTime();
    if (Number.isNaN(ms)) return value;
    if (ms < 0) return 'in the future';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d2 = Math.floor(h / 24);
    return `${d2}d ago`;
  } catch {
    return value;
  }
}

export function formatAtomic(amountAtomic: string | null | undefined, decimals = 6): string {
  if (!amountAtomic) return '—';
  try {
    const n = BigInt(amountAtomic);
    const base = 10n ** BigInt(decimals);
    const whole = n / base;
    const frac = n % base;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fracStr ? `${whole.toString()}.${fracStr}` : whole.toString();
  } catch {
    return amountAtomic;
  }
}
