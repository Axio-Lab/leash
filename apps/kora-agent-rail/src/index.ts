import { serve } from '@hono/node-server';

import { createKoraAgentRailApp } from './app.js';
import { buildCapabilities } from './capabilities.js';
import { loadConfig } from './config.js';
import { KoraClient } from './kora.js';
import { DemoTrustAdapter, LeashTrustAdapter } from './leash.js';
import { CompositeReceiptSink, MemoryReceiptSink, WebhookReceiptSink } from './receipts.js';
import { InMemoryKoraAgentStore } from './store.js';

const config = loadConfig();
const capabilities = buildCapabilities(config.publicBaseUrl);
const store = new InMemoryKoraAgentStore({
  id: config.defaultAgent.id,
  policy: config.defaultAgent.policy,
  capabilities,
});
const memoryReceipts = new MemoryReceiptSink();
const webhookSink = config.leash.receiptWebhookUrl
  ? [new WebhookReceiptSink(config.leash.receiptWebhookUrl)]
  : [];

const app = createKoraAgentRailApp({
  config,
  store,
  kora: new KoraClient(config.kora),
  trust: config.leash.requireLeash
    ? new LeashTrustAdapter(config.leash.apiUrl, {
        requireSignature: config.leash.requireSignature,
      })
    : new DemoTrustAdapter(),
  receipts: new CompositeReceiptSink([memoryReceipts, ...webhookSink]),
});

serve({ fetch: app.fetch, port: config.port });
// eslint-disable-next-line no-console
console.log(`kora-agent-rail on :${config.port}`);
