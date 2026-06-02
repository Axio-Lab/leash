import type { KoraReceipt } from './types.js';

export type ReceiptSink = {
  record(receipt: KoraReceipt): Promise<void>;
};

export class CompositeReceiptSink implements ReceiptSink {
  constructor(private readonly sinks: ReceiptSink[]) {}

  async record(receipt: KoraReceipt): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.record(receipt)));
  }
}

export class MemoryReceiptSink implements ReceiptSink {
  readonly receipts: KoraReceipt[] = [];

  async record(receipt: KoraReceipt): Promise<void> {
    this.receipts.unshift(receipt);
  }
}

export class WebhookReceiptSink implements ReceiptSink {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async record(receipt: KoraReceipt): Promise<void> {
    const res = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(receipt),
    });
    if (!res.ok) {
      throw new Error(`receipt webhook returned HTTP ${res.status}`);
    }
  }
}
