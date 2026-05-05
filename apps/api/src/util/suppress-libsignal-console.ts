/**
 * `@whiskeysockets/libsignal-node` (pulled in by Baileys) logs full SessionEntry
 * objects on every session rotation via `console.info` / `console.warn`. That
 * drowns out legitimate API logs and has nothing to do with Telegram.
 *
 * Silence those lines by default. Set `LEASH_LIBSIGNAL_VERBOSE=1` to see them.
 */

const g = globalThis as typeof globalThis & { __leashLibsignalConsoleFiltered?: boolean };

function isLibsignalNoise(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  return (
    message.startsWith('Closing session') ||
    message === 'Closing open session in favor of incoming prekey bundle' ||
    message.startsWith('Opening session') ||
    message === 'Session already open' ||
    message.startsWith('Session already closed')
  );
}

if (process.env.LEASH_LIBSIGNAL_VERBOSE !== '1' && !g.__leashLibsignalConsoleFiltered) {
  g.__leashLibsignalConsoleFiltered = true;
  const origInfo = console.info.bind(console);
  const origWarn = console.warn.bind(console);
  console.info = (...args: unknown[]) => {
    if (args.length > 0 && isLibsignalNoise(args[0])) return;
    origInfo(...args);
  };
  console.warn = (...args: unknown[]) => {
    if (args.length > 0 && isLibsignalNoise(args[0])) return;
    origWarn(...args);
  };
}
