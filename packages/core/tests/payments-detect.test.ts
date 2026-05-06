import { describe, expect, it } from 'vitest';
import { detectProtocol, detectProtocolStrict, MPP_PROBLEM_TYPE } from '../src/payments/detect.js';

const mppBody = {
  type: MPP_PROBLEM_TYPE,
  status: 402 as const,
  challengeId: 'ch-test',
  request: {
    recipient: 'PayTo1111111111111111111111111111111111',
    amount: '1000',
    currency: 'USDC',
    network: 'solana-devnet',
    asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  },
};

const x402Header = 'eyJhY2NlcHRzIjpbXX0='; // base64({"accepts":[]})

describe('detectProtocol', () => {
  it('returns none for non-402 responses', async () => {
    const det = await detectProtocol(new Response('ok', { status: 200 }));
    expect(det.protocol).toBe('none');
    expect(det.status).toBe(200);
  });

  it('detects x402 from payment-required header', async () => {
    const r = new Response('', {
      status: 402,
      headers: { 'payment-required': x402Header },
    });
    const det = await detectProtocol(r);
    expect(det.protocol).toBe('x402');
    if (det.protocol === 'x402') expect(det.paymentRequiredHeader).toBe(x402Header);
  });

  it('detects MPP from problem+json body', async () => {
    const r = new Response(JSON.stringify(mppBody), {
      status: 402,
      headers: { 'content-type': 'application/problem+json' },
    });
    const det = await detectProtocol(r);
    expect(det.protocol).toBe('mpp');
    if (det.protocol === 'mpp') expect(det.challenge.challengeId).toBe('ch-test');
  });

  it('marks unknown 402 with no header and no MPP body', async () => {
    const r = new Response('plain text 402', { status: 402 });
    const det = await detectProtocol(r);
    expect(det.protocol).toBe('unknown');
  });

  it('does not consume the response body', async () => {
    const r = new Response(JSON.stringify(mppBody), { status: 402 });
    await detectProtocol(r);
    const body = await r.text();
    expect(body).toContain('ch-test');
  });

  it('detectProtocolStrict throws on unknown', async () => {
    const r = new Response('', { status: 402 });
    await expect(detectProtocolStrict(r)).rejects.toThrow(/neither x402 nor MPP/);
  });

  it('detectProtocolStrict throws on non-402', async () => {
    const r = new Response('ok', { status: 200 });
    await expect(detectProtocolStrict(r)).rejects.toThrow(/expected 402/);
  });
});
