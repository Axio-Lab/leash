import { describe, expect, it } from 'vitest';

import {
  escapeTelegramText,
  formatArtifactForTelegram,
  toTelegramMarkdownV2,
} from '../src/external/formatter.js';

describe('escapeTelegramText', () => {
  it('escapes every MarkdownV2 reserved character', () => {
    const input = '_*[]()~`>#+-=|{}.!\\';
    const escaped = escapeTelegramText(input);
    // Backtick is intentionally not escaped (we wrap code spans), so
    // every other char must have a leading backslash.
    expect(escaped).toBe('\\_\\*\\[\\]\\(\\)\\~`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!\\\\');
  });

  it('leaves plain text alone', () => {
    expect(escapeTelegramText('hello world')).toBe('hello world');
  });
});

describe('toTelegramMarkdownV2', () => {
  it('escapes plain prose with embedded periods and parens', () => {
    const md = 'Your last receipt was 0xabc (devnet). Open it.';
    const out = toTelegramMarkdownV2(md);
    expect(out).toContain('\\(devnet\\)');
    expect(out).toContain('Open it\\.');
  });

  it('preserves ``` code fences with internal backticks escaped', () => {
    const md = 'before\n```ts\nconst x = `hi`;\n```\nafter';
    const out = toTelegramMarkdownV2(md);
    expect(out).toContain('```');
    expect(out).toContain('\\`hi\\`');
  });

  it('renders bold via ** and italic via _', () => {
    const md = 'text **bold** and _ital_ end';
    const out = toTelegramMarkdownV2(md);
    expect(out).toContain('*bold*');
    expect(out).toContain('_ital_');
  });

  it('rewrites markdown links into MarkdownV2 with escaped labels', () => {
    const md = 'See [my agent](https://explorer.leash.market/agent/abc) here.';
    const out = toTelegramMarkdownV2(md);
    expect(out).toContain('[my agent](https://explorer.leash.market/agent/abc)');
    expect(out).toContain('here\\.');
  });
});

describe('formatArtifactForTelegram', () => {
  it('renders a withdraw card with an approve link', () => {
    const out = formatArtifactForTelegram({
      kind: 'withdraw_request',
      payload: {
        token: 'USDC',
        amount: '5.00',
        destination: 'FFvPUNGYsQa4vjLAcCJ4zx8vZ4BSqQoCbMMyG3VNuEnd',
      },
      approveUrl: 'https://agents.leash.market/approve/abc',
    });
    expect(out).toContain('*Withdraw*');
    expect(out).toContain('Approve in browser');
    expect(out).toContain('https://agents.leash.market/approve/abc');
  });

  it('renders a payment_link card with a clickable URL', () => {
    const out = formatArtifactForTelegram({
      kind: 'payment_link',
      payload: { url: 'https://api.leash.market/x/abc', label: 'API access' },
    });
    expect(out).toContain('*Payment link created*');
    expect(out).toContain('API access');
    expect(out).toContain('(https://api.leash.market/x/abc)');
  });
});
