import { randomBytes } from 'node:crypto';

/** In-memory x402 facilitator for unit tests (no chain, no real verify). */
export class LocalFacilitator {
  private settled = new Map<string, unknown>();

  async verify(_payment: unknown): Promise<{ valid: boolean; payer?: string }> {
    return { valid: true, payer: 'local-payer' };
  }

  async settle(payment: unknown): Promise<{ success: boolean; txSig: string }> {
    const key = JSON.stringify(payment);
    const txSig = `mock-${randomBytes(8).toString('hex')}`;
    this.settled.set(txSig, payment);
    return { success: true, txSig };
  }

  wasSettled(txSig: string): boolean {
    return this.settled.has(txSig);
  }
}
