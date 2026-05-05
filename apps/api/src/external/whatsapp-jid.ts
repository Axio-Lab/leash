/**
 * Normalise a phone number / partial JID into the full
 * `<digits>@s.whatsapp.net` shape Baileys expects on `sendMessage`.
 * Fully-qualified JIDs pass through unchanged.
 */
export function waJidForPhone(value: string): string {
  if (value.includes('@')) return value;
  const digits = value.replace(/[^\d]/g, '');
  return `${digits}@s.whatsapp.net`;
}
