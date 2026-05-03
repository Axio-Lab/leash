/**
 * Minimal Telegram Bot API client.
 *
 * We talk to the public Bot API directly with `fetch` rather than
 * pulling in `node-telegram-bot-api` / `grammy` — only the dispatcher
 * needs it, the surface area is tiny (sendMessage, getMe, setWebhook),
 * and avoiding a transitive dep keeps this package's footprint small.
 *
 * The base URL is overridable so tests can point it at a stub server.
 */

export type TelegramSendMessageArgs = {
  chatId: string;
  text: string;
  /** When set, Telegram parses inline formatting using the named flavour. */
  parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown';
  /** Disable the link-preview card when text contains URLs. */
  disableWebPagePreview?: boolean;
  /** Reply quoting another message id in the same chat. */
  replyToMessageId?: number;
};

export type TelegramGetMeResult = {
  id: number;
  is_bot: boolean;
  username: string;
  first_name?: string;
};

export type TelegramClient = {
  sendMessage(
    args: TelegramSendMessageArgs,
  ): Promise<{ ok: boolean; status: number; body: string }>;
  getMe(): Promise<TelegramGetMeResult>;
};

export type TelegramClientOptions = {
  botToken: string;
  /** Override for tests. Defaults to the public Telegram Bot API. */
  baseUrl?: string;
  /**
   * Fetch override — useful in tests to inject a stub. Defaults to
   * `globalThis.fetch`.
   */
  fetcher?: typeof fetch;
};

export function createTelegramClient(opts: TelegramClientOptions): TelegramClient {
  const baseUrl = (opts.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/, '');
  const fetchImpl = opts.fetcher ?? globalThis.fetch;

  async function call(method: string, payload: Record<string, unknown>): Promise<Response> {
    const url = `${baseUrl}/bot${opts.botToken}/${method}`;
    return fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  return {
    async sendMessage(args) {
      const payload: Record<string, unknown> = {
        chat_id: args.chatId,
        text: args.text,
      };
      if (args.parseMode) payload.parse_mode = args.parseMode;
      if (args.disableWebPagePreview != null) {
        payload.disable_web_page_preview = args.disableWebPagePreview;
      }
      if (args.replyToMessageId != null) {
        payload.reply_parameters = { message_id: args.replyToMessageId };
      }
      const res = await call('sendMessage', payload);
      const body = await res.text();
      return { ok: res.ok, status: res.status, body };
    },

    async getMe() {
      const res = await call('getMe', {});
      const body = await res.text();
      if (!res.ok) {
        throw new Error(`telegram getMe failed: ${res.status} ${body.slice(0, 200)}`);
      }
      const json = JSON.parse(body) as { ok: boolean; result?: TelegramGetMeResult };
      if (!json.ok || !json.result) {
        throw new Error(`telegram getMe returned non-ok: ${body.slice(0, 200)}`);
      }
      return json.result;
    },
  };
}
