/**
 * AES-256-GCM helpers for at-rest encryption of user-supplied secrets
 * (currently the user's LLM provider key — Anthropic / OpenAI). Format
 * is `v1:<iv-hex>:<ciphertext-hex>:<tag-hex>` so we can rotate the
 * scheme later by bumping the version prefix.
 *
 * The encryption key is a 32-byte hex string read from `ENCRYPTION_KEY`
 * by callers. We DO NOT read it from `process.env` here — services are
 * expected to validate their env once at startup and pass the key in.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function keyBuffer(hexKey: string): Buffer {
  const buf = Buffer.from(hexKey, 'hex');
  if (buf.length !== 32) {
    throw new Error(`encryption key must be 32 bytes (64 hex chars); got ${buf.length}`);
  }
  return buf;
}

export function encryptSecret(plaintext: string, hexKey: string): string {
  const key = keyBuffer(hexKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv) as CipherGCM;
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptSecret(envelope: string, hexKey: string): string {
  const parts = envelope.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('encryption envelope: unsupported format');
  }
  const [, ivHex, ctHex, tagHex] = parts;
  const key = keyBuffer(hexKey);
  const iv = Buffer.from(ivHex!, 'hex');
  const ct = Buffer.from(ctHex!, 'hex');
  const tag = Buffer.from(tagHex!, 'hex');
  const decipher = createDecipheriv(ALGO, key, iv) as DecipherGCM;
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}
