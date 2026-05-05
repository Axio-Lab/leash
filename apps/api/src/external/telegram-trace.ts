/**
 * Opt-in terminal logging for the Telegram webhook → dispatcher path.
 *
 * Default: enabled when `NODE_ENV !== 'production'`.
 * Override: `LEASH_EXTERNAL_TELEGRAM_LOG=1` (force on) or `=0` (force off).
 */

export function tgExternalVerbose(): boolean {
  const v = process.env.LEASH_EXTERNAL_TELEGRAM_LOG?.trim();
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  if (process.env.NODE_ENV === 'test') return false;
  return process.env.NODE_ENV !== 'production';
}

/** Single-line safe preview for logs (no newlines, capped length). */
export function tgClip(s: string, max = 140): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function tgLog(message: string, obj?: Record<string, unknown>): void {
  if (!tgExternalVerbose()) return;
  if (obj !== undefined && Object.keys(obj).length > 0) {
    // eslint-disable-next-line no-console
    console.info(`[external:tg] ${message}`, obj);
  } else {
    // eslint-disable-next-line no-console
    console.info(`[external:tg] ${message}`);
  }
}
