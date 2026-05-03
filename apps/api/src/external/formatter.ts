/**
 * Channel-native message formatters.
 *
 * The agent loop emits free-form markdown. Telegram's `MarkdownV2`
 * parser is strict — every literal `_ * [ ] ( ) ~ ` > # + - = | { } . !`
 * inside non-formatted text MUST be backslash-escaped, otherwise the
 * whole message is rejected with `Bad Request: can't parse entities`.
 * WhatsApp (Phase 2) accepts a smaller, looser dialect (`*bold*`,
 * `_italic_`, ```` ```code``` ```` only) and silently ignores anything
 * else, so its formatter is a near-passthrough.
 *
 * We keep the implementation deliberately small (no remark/markdown-it):
 * the agent's reply markdown is shallow, and a full AST round-trip
 * would slow every turn for marginal fidelity gains.
 */

/**
 * Set of literal characters that MarkdownV2 requires escaped. Telegram's
 * spec lists `_*[]()~`>#+-=|{}.!` — backtick is intentionally NOT in the
 * set because we wrap code spans with it ourselves.
 *   https://core.telegram.org/bots/api#markdownv2-style
 */
const TG_MD_V2_ESCAPE = /([_*[\]()~>#+\-=|{}.!\\])/g;

/** Escape a string for safe inclusion in Telegram MarkdownV2 plaintext. */
export function escapeTelegramText(input: string): string {
  return input.replace(TG_MD_V2_ESCAPE, '\\$1');
}

type LinkSpec = { label: string; url: string };

/**
 * Render an inline link in MarkdownV2: `[label](url)`. Both label and
 * URL must escape MarkdownV2 specials, otherwise Telegram rejects the
 * whole payload. URLs additionally need backslash escapes for `(`/`)`/`\`.
 */
export function telegramLink(spec: LinkSpec): string {
  const label = escapeTelegramText(spec.label);
  const url = spec.url.replace(/[)\\]/g, (m) => `\\${m}`);
  return `[${label}](${url})`;
}

/**
 * Convert a generic markdown string (from the LLM) into a
 * MarkdownV2-safe payload. Strategy:
 *   - Code fences (` ```...``` `) are preserved verbatim — Telegram
 *     forwards their contents as-is in pre blocks.
 *   - Inline code (`` `...` ``) is preserved.
 *   - Bold (`**foo**` / `__foo__`) → `*foo*`.
 *   - Italic (`*foo*` / `_foo_`) is intentionally normalised to `_foo_`
 *     (Telegram's italic) only when the source used underscores; the
 *     more ambiguous `*foo*` form is left alone to avoid colliding with
 *     stray asterisks the model uses as bullets.
 *   - Markdown links `[label](url)` are passed through after escaping.
 *   - Everything else is escaped.
 *
 * The resulting string passes Telegram's MarkdownV2 validator for any
 * input we've observed in QA. If a future model output trips a parse
 * error in production the dispatcher catches it and retries with
 * `parseMode` unset (plain text) so the user always sees something.
 */
export function toTelegramMarkdownV2(markdown: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < markdown.length) {
    // Code fence — find the closing ```.
    if (markdown.startsWith('```', i)) {
      const end = markdown.indexOf('```', i + 3);
      if (end === -1) {
        // Unterminated fence — degrade to escaped text.
        out.push(escapeTelegramText(markdown.slice(i)));
        i = markdown.length;
        break;
      }
      // Skip optional language tag on the open line.
      const inner = markdown.slice(i + 3, end);
      const firstNl = inner.indexOf('\n');
      const body = firstNl >= 0 ? inner.slice(firstNl + 1) : inner;
      // Inside ``` blocks Telegram still requires \ ` and \\ to be
      // escaped, but everything else is verbatim.
      const escapedBody = body.replace(/[`\\]/g, (m) => `\\${m}`);
      out.push('```\n');
      out.push(escapedBody);
      out.push('\n```');
      i = end + 3;
      continue;
    }
    // Inline code span.
    if (markdown[i] === '`') {
      const end = markdown.indexOf('`', i + 1);
      if (end > i) {
        const inner = markdown.slice(i + 1, end);
        const escaped = inner.replace(/[`\\]/g, (m) => `\\${m}`);
        out.push('`');
        out.push(escaped);
        out.push('`');
        i = end + 1;
        continue;
      }
    }
    // Markdown link [label](url).
    if (markdown[i] === '[') {
      const closeBracket = markdown.indexOf(']', i + 1);
      if (closeBracket > 0 && markdown[closeBracket + 1] === '(') {
        const closeParen = markdown.indexOf(')', closeBracket + 2);
        if (closeParen > closeBracket + 2) {
          const label = markdown.slice(i + 1, closeBracket);
          const url = markdown.slice(closeBracket + 2, closeParen);
          out.push(telegramLink({ label, url }));
          i = closeParen + 1;
          continue;
        }
      }
    }
    // Bold `**...**` → `*...*` after escaping inner. We bound the
    // search window so an unterminated marker degrades to plain text.
    if (markdown.startsWith('**', i)) {
      const end = markdown.indexOf('**', i + 2);
      if (end > i + 2 && end - (i + 2) < 256) {
        const inner = markdown.slice(i + 2, end);
        out.push('*');
        out.push(escapeTelegramText(inner));
        out.push('*');
        i = end + 2;
        continue;
      }
    }
    // Underscore italic `_..._` → MarkdownV2 italic. Same bounded
    // search; we explicitly *don't* try to detect `*foo*` italic
    // because asterisks in the wild often mean bullets, not emphasis.
    if (markdown[i] === '_') {
      const end = markdown.indexOf('_', i + 1);
      if (end > i + 1 && end - (i + 1) < 256 && markdown[end - 1] !== ' ') {
        const inner = markdown.slice(i + 1, end);
        if (inner.length > 0 && inner.length < 200 && !inner.includes('\n')) {
          out.push('_');
          out.push(escapeTelegramText(inner));
          out.push('_');
          i = end + 1;
          continue;
        }
      }
    }
    // Default: escape one char.
    out.push(escapeTelegramText(markdown[i]!));
    i++;
  }
  return out.join('');
}

/**
 * WhatsApp (Phase 2) only understands `*bold*`, `_italic_`,
 * `~strikethrough~`, and ``` ```code``` ``` blocks. It silently strips
 * brackets / backticks it doesn't recognise. We just pass markdown
 * through with a couple of normalisations: `**foo**` → `*foo*`, link
 * `[label](url)` → `label (url)`.
 */
export function toWhatsApp(markdown: string): string {
  return markdown.replace(/\*\*(.+?)\*\*/g, '*$1*').replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

/**
 * Sub-300-char human-friendly summary of a tool artifact, formatted
 * for the channel. The dispatcher appends one of these per
 * `payment_request` / `withdraw_request` / `payment_link` artifact so
 * the user knows what's pending without having to leave the chat.
 *
 * For Pattern A (deep_link) signing tools, `approveUrl` is the
 * one-time confirm URL; we render it as a clickable link in the
 * channel's flavour.
 */
export type ArtifactSummary = {
  kind: 'payment_request' | 'withdraw_request' | 'payment_link' | 'receipt' | 'tool_call';
  payload: Record<string, unknown>;
  approveUrl?: string | null;
};

export function formatArtifactForTelegram(art: ArtifactSummary): string {
  const lines: string[] = [];
  switch (art.kind) {
    case 'payment_request': {
      const url = String(art.payload.url ?? '');
      const preview = (art.payload.preview ?? {}) as {
        amount?: string;
        currency?: string;
        recipient?: string;
      };
      lines.push(`*Pay request*`);
      if (preview.amount && preview.currency) {
        lines.push(escapeTelegramText(`Amount: ${preview.amount} ${preview.currency}`));
      }
      if (preview.recipient) {
        lines.push(escapeTelegramText(`Recipient: ${String(preview.recipient)}`));
      }
      if (url) lines.push(escapeTelegramText(`URL: ${url}`));
      if (art.approveUrl) {
        lines.push(telegramLink({ label: 'Approve in browser', url: art.approveUrl }));
      }
      break;
    }
    case 'withdraw_request': {
      const token = String(art.payload.token ?? '');
      const amount = String(art.payload.amount ?? '');
      const dest = String(art.payload.destination ?? '');
      lines.push(`*Withdraw*`);
      lines.push(escapeTelegramText(`${amount} ${token} → ${dest}`));
      if (art.approveUrl) {
        lines.push(telegramLink({ label: 'Approve in browser', url: art.approveUrl }));
      }
      break;
    }
    case 'payment_link': {
      const label = String(art.payload.label ?? '');
      const price = String(art.payload.amount ?? art.payload.price ?? '');
      const url = String(art.payload.url ?? '');
      lines.push(`*Payment link created*`);
      if (label) lines.push(escapeTelegramText(label));
      if (price) lines.push(escapeTelegramText(price));
      if (url) lines.push(telegramLink({ label: url, url }));
      break;
    }
    case 'receipt': {
      const hash = String(art.payload.receipt_hash ?? '');
      lines.push(`*Receipt*`);
      if (hash) lines.push(`\`${escapeTelegramText(hash)}\``);
      break;
    }
    case 'tool_call':
    default: {
      lines.push(`*Tool call*`);
      lines.push(`\`${escapeTelegramText(JSON.stringify(art.payload).slice(0, 200))}\``);
      break;
    }
  }
  return lines.join('\n');
}

export function formatArtifactForWhatsApp(art: ArtifactSummary): string {
  switch (art.kind) {
    case 'payment_request': {
      const url = String(art.payload.url ?? '');
      const lines = [`*Pay request*`];
      if (url) lines.push(`URL: ${url}`);
      if (art.approveUrl) lines.push(`Approve: ${art.approveUrl}`);
      return lines.join('\n');
    }
    case 'withdraw_request': {
      const lines = [
        `*Withdraw*`,
        `${art.payload.amount ?? ''} ${art.payload.token ?? ''} → ${art.payload.destination ?? ''}`,
      ];
      if (art.approveUrl) lines.push(`Approve: ${art.approveUrl}`);
      return lines.join('\n');
    }
    case 'payment_link': {
      const url = String(art.payload.url ?? '');
      return [`*Payment link*`, String(art.payload.label ?? ''), url].filter(Boolean).join('\n');
    }
    default:
      return `*${art.kind}*`;
  }
}

/**
 * The list of artifact kinds whose chat-host result is "the user must
 * sign with Privy". These ALWAYS deep-link, regardless of whether the
 * connection is in `delegated` mode (Pattern C). Withdrawals + spend
 * delegation changes are too dangerous to ever let a server-held key
 * sign on behalf of the user, so this list mirrors the security
 * guarantees we promised in the planning conversation.
 */
export const ALWAYS_DEEP_LINK_KINDS: ReadonlySet<ArtifactSummary['kind']> = new Set([
  'withdraw_request',
]);
