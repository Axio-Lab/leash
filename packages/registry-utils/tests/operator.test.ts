import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519';
import {
  generateOperatorKeypair,
  operatorFromSeed,
  signWithOperator,
  exportOperatorJson,
  importOperatorJson,
  operatorPublicId,
  pubkeyToBytes,
  operatorRegistration,
  readOperatorRegistration,
} from '../src/operator.js';

describe('operator keypair helpers', () => {
  it('generates a valid ed25519 keypair with a base58 pubkey of 32 bytes', () => {
    const kp = generateOperatorKeypair();
    expect(kp.publicKey).toHaveLength(32);
    expect(kp.secretKey).toHaveLength(64);
    expect(kp.pubkey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(pubkeyToBytes(kp.pubkey)).toEqual(kp.publicKey);
    // The Solana convention secretKey = secret(32) || public(32).
    expect(kp.secretKey.slice(32)).toEqual(kp.publicKey);
  });

  it('derives a deterministic keypair from a 32-byte seed', () => {
    const seed = new Uint8Array(32).fill(7);
    const a = operatorFromSeed(seed);
    const b = operatorFromSeed(seed);
    expect(a.pubkey).toBe(b.pubkey);
    expect(a.secretKey).toEqual(b.secretKey);
  });

  it('rejects bad seed sizes', () => {
    expect(() => operatorFromSeed(new Uint8Array(31))).toThrow(/32 bytes/);
  });

  it('round-trips through exportOperatorJson / importOperatorJson', () => {
    const kp = generateOperatorKeypair();
    const json = exportOperatorJson(kp);
    const decoded = importOperatorJson(json);
    expect(decoded.pubkey).toBe(kp.pubkey);
    expect(decoded.secretKey).toEqual(kp.secretKey);
  });

  it('rejects malformed exports', () => {
    expect(() => importOperatorJson(JSON.stringify([1, 2, 3]))).toThrow(/64 bytes/);
    expect(() => importOperatorJson('not-json')).toThrow();
  });

  it('produces a signature that verifies with @noble/curves/ed25519', () => {
    const kp = generateOperatorKeypair();
    const message = new TextEncoder().encode('hello x402');
    const sig = signWithOperator(kp.secretKey, message);
    expect(ed25519.verify(sig, message, kp.publicKey)).toBe(true);
  });

  it('exposes a stable fingerprint that hides the secret', () => {
    const kp = generateOperatorKeypair();
    const id = operatorPublicId(kp);
    expect(id.pubkey).toBe(kp.pubkey);
    expect(id.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    // Sanity: the fingerprint is deterministic per pubkey.
    expect(operatorPublicId(kp).fingerprint).toBe(id.fingerprint);
  });

  it('round-trips through the AgentRegistration helpers', () => {
    const kp = generateOperatorKeypair();
    const reg = operatorRegistration(kp.pubkey);
    expect(reg.agentRegistry).toBe('leash:operator');
    expect(reg.agentId).toBe(`solana:${kp.pubkey}`);
    expect(readOperatorRegistration(reg)).toBe(kp.pubkey);
    expect(readOperatorRegistration({ agentRegistry: 'other', agentId: kp.pubkey })).toBeNull();
    expect(readOperatorRegistration(null)).toBeNull();
  });
});
