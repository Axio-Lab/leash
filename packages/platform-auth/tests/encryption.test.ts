import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret } from '../src/encryption.js';

const KEY = '0'.repeat(64);

describe('encryption', () => {
  it('round-trips a secret', () => {
    const sealed = encryptSecret('sk-live-abc-123', KEY);
    expect(sealed).toMatch(/^v1:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(decryptSecret(sealed, KEY)).toBe('sk-live-abc-123');
  });

  it('produces a different envelope each time (random IV)', () => {
    const a = encryptSecret('hello', KEY);
    const b = encryptSecret('hello', KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe('hello');
    expect(decryptSecret(b, KEY)).toBe('hello');
  });

  it('rejects a tampered envelope', () => {
    const sealed = encryptSecret('hello', KEY);
    const parts = sealed.split(':');
    const ct = Buffer.from(parts[2]!, 'hex');
    ct[0] = ct[0]! ^ 0x01;
    parts[2] = ct.toString('hex');
    expect(() => decryptSecret(parts.join(':'), KEY)).toThrow();
  });

  it('rejects the wrong key', () => {
    const sealed = encryptSecret('hello', KEY);
    expect(() => decryptSecret(sealed, '1'.repeat(64))).toThrow();
  });

  it('rejects an invalid key length', () => {
    expect(() => encryptSecret('hello', '00')).toThrow(/32 bytes/);
  });
});
