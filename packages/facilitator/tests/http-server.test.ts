/**
 * HTTP server smoke tests for `@leash/facilitator`.
 *
 * The interesting surface for the Leash protocol fee work is `/health`:
 * operators rely on it (and the docs encourage them) to confirm the
 * deploy is in `enforce` mode and that the right treasury authority
 * is wired up. We assert both the absence (no `protocol_fee` block when
 * none is provided) and the presence (block surfaces verbatim when the
 * caller passes one) so future refactors can't silently drop the
 * snapshot.
 */
import { describe, it, expect } from 'vitest';
import type { x402Facilitator } from '@x402/core/facilitator';
import { createFacilitatorHttpServer, type ProtocolFeeHealthBlock } from '../src/http/server.js';

function stubFacilitator(): x402Facilitator {
  return {
    getSupported: () => ({ kinds: [], extensions: [], signers: {} }),
    verify: async () => ({ isValid: true, payer: 'noop' }),
    settle: async () => ({
      success: true,
      transaction: 'noop',
      network: 'solana-devnet',
      payer: 'noop',
    }),
  } as unknown as x402Facilitator;
}

describe('createFacilitatorHttpServer', () => {
  it('GET /health returns ok=true and echoes signers + networks', async () => {
    const app = createFacilitatorHttpServer({
      facilitator: stubFacilitator(),
      signerAddresses: ['Sign1111111111111111111111111111111111111111'],
      networks: ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
    });
    const res = await app.request('http://localhost/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      networks: string[];
      signers: string[];
      protocol_fee?: unknown;
    };
    expect(body.ok).toBe(true);
    expect(body.signers).toEqual(['Sign1111111111111111111111111111111111111111']);
    expect(body.networks).toEqual(['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1']);
    expect(body.protocol_fee).toBeUndefined();
  });

  it('GET /health surfaces the protocol_fee block when configured', async () => {
    const protocolFee: ProtocolFeeHealthBlock = {
      bps: 100,
      networks: {
        'solana-mainnet': {
          enforce: 'enforce',
          authority: '3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W',
        },
        'solana-devnet': {
          enforce: 'warn',
          authority: '3DdcJkvjW7KLtMeko3Zr57jEJWhqRHuPsEBFm1XJYh7W',
        },
      },
    };
    const app = createFacilitatorHttpServer({
      facilitator: stubFacilitator(),
      signerAddresses: [],
      networks: [],
      protocolFee,
    });
    const res = await app.request('http://localhost/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { protocol_fee: ProtocolFeeHealthBlock };
    expect(body.protocol_fee).toEqual(protocolFee);
  });

  it('GET /supported returns the underlying facilitator support payload', async () => {
    const app = createFacilitatorHttpServer({
      facilitator: stubFacilitator(),
      signerAddresses: [],
      networks: [],
    });
    const res = await app.request('http://localhost/supported');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kinds: unknown[] };
    expect(Array.isArray(body.kinds)).toBe(true);
  });

  it('POST /verify and /settle reject malformed bodies with 400', async () => {
    const app = createFacilitatorHttpServer({
      facilitator: stubFacilitator(),
      signerAddresses: [],
      networks: [],
    });
    const verify = await app.request('http://localhost/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(verify.status).toBe(400);
    const settle = await app.request('http://localhost/settle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paymentPayload: {} }),
    });
    expect(settle.status).toBe(400);
  });
});
