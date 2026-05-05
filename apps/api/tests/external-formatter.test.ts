import { describe, expect, it } from 'vitest';

import {
  escapeTelegramText,
  formatArtifactForTelegram,
  formatArtifactForWhatsApp,
  stripEchoedPaymentRequestCardFromAssistantText,
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

  it('renders single-asterisk emphasis as bold', () => {
    const md = '26 skills across *IDEA*, *BUILD*, and *LAUNCH*.';
    const out = toTelegramMarkdownV2(md);
    expect(out).toContain('*IDEA*');
    expect(out).toContain('*BUILD*');
    expect(out).toContain('*LAUNCH*');
    expect(out).not.toContain('\\*IDEA');
  });

  it('does not turn bullet markers or arithmetic into bold', () => {
    const bulletMd = '* item one\n* item two';
    const bulletOut = toTelegramMarkdownV2(bulletMd);
    // Each leading `*` followed by a space stays escaped — there is no
    // closing marker on the same line so the heuristic must skip it.
    expect(bulletOut).toContain('\\* item one');
    expect(bulletOut).toContain('\\* item two');

    const arithOut = toTelegramMarkdownV2('2*3=6');
    expect(arithOut.includes('*3*')).toBe(false);
  });

  it('rewrites markdown links into MarkdownV2 with escaped labels', () => {
    const md = 'See [my agent](https://explorer.leash.market/agent/abc) here.';
    const out = toTelegramMarkdownV2(md);
    expect(out).toContain('[my agent](https://explorer.leash.market/agent/abc)');
    expect(out).toContain('here\\.');
  });
});

describe('stripEchoedPaymentRequestCardFromAssistantText', () => {
  const summaries = [
    {
      kind: 'payment_request' as const,
      payload: { url: 'https://api.example/x/jkl' },
      approveUrl: 'https://agents.example/approve/tok',
    },
  ];

  it('removes echoed Pay request / URL / Approve lines', () => {
    const prose = [
      'Please review the Pay card.',
      '',
      '**Pay request**',
      'URL: https://api.example/x/jkl',
      'Approve: https://agents.example/approve/tok',
    ].join('\n');
    const out = stripEchoedPaymentRequestCardFromAssistantText(prose, summaries);
    expect(out).toBe('Please review the Pay card.');
  });

  it('is a no-op when there is no payment_request summary', () => {
    const text = 'Pay request\nURL: https://x.test/y';
    expect(stripEchoedPaymentRequestCardFromAssistantText(text, [])).toBe(text);
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

  it('renders payment_request as the approve URL only', () => {
    const out = formatArtifactForTelegram({
      kind: 'payment_request',
      payload: { url: 'https://api.example/x/abc', preview: { amount: '10', currency: 'USDC' } },
      approveUrl: 'https://agents.example/approve/token123',
    });
    expect(out).not.toContain('Pay request');
    expect(out).not.toContain('api.example');
    expect(out).toContain('agents.example');
    expect(out).toContain('approve/token123');
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

describe('formatArtifactForWhatsApp', () => {
  it('renders payment_request as the approve URL only', () => {
    expect(
      formatArtifactForWhatsApp({
        kind: 'payment_request',
        payload: { url: 'https://api.example/x/abc' },
        approveUrl: 'https://agents.example/approve/token123',
      }),
    ).toBe('https://agents.example/approve/token123');
  });
});
